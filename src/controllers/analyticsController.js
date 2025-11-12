const dbModule = require('../utils/db');
const db = dbModule.db;
const insertRecord = dbModule.insertRecord;
const save = dbModule.save;
const { analyzeTone } = require('../services/openaiService');

/**
 * Generate an analytics snapshot for a given organisation.  Aggregates
 * average hours worked, wellbeing, cost and filled rate across all
 * historical data.  This can be called periodically to build a
 * warehouse of metrics for forecasting.
 *
 * @param {string|number} organisationId
 */
function generateSnapshot(organisationId) {
  const orgIdStr = String(organisationId);
  // Compute average hours worked from payroll_records
  let totalHours = 0;
  let recordsCount = 0;
  db.payroll_records.forEach(pr => {
    if (String(pr.organisation_id) === orgIdStr) {
      totalHours += pr.hours_worked || 0;
      recordsCount++;
    }
  });
  const avgHours = recordsCount > 0 ? totalHours / recordsCount : 0;
  // Compute average wellbeing from wellbeing_summaries
  let totalWellbeing = 0;
  let wellbeingCount = 0;
  db.wellbeing_summaries.forEach(ws => {
    const staff = db.staff.find(s => s.id === ws.staff_id);
    if (staff && String(staff.organisation_id) === orgIdStr) {
      totalWellbeing += ws.score;
      wellbeingCount++;
    }
  });
  const avgWellbeing = wellbeingCount > 0 ? totalWellbeing / wellbeingCount : 0;
  // Compute average cost per payroll record
  let totalCost = 0;
  db.payroll_records.forEach(pr => {
    if (String(pr.organisation_id) === orgIdStr) totalCost += pr.total_pay || 0;
  });
  const avgCost = recordsCount > 0 ? totalCost / recordsCount : 0;
  // Compute filled rate: ratio of filled to total shifts
  const shifts = db.shifts.filter(s => String(s.organisation_id) === orgIdStr);
  const totalShifts = shifts.length;
  const filled = shifts.filter(s => s.status.toLowerCase() === 'filled').length;
  const filledRate = totalShifts > 0 ? filled / totalShifts : 0;
  const snapshot = insertRecord('analytics_snapshots', {
    organisation_id: organisationId,
    date: new Date().toISOString().split('T')[0],
    avg_hours: avgHours,
    avg_wellbeing: avgWellbeing,
    avg_cost: avgCost,
    filled_rate: filledRate
  });
  return snapshot;
}

/**
 * Predict future staffing metrics using simple heuristics based on
 * historical data.  Returns expected open shifts, burnout alerts and
 * cost forecast for the next prediction window (e.g. 7 days).
 *
 * @param {string|number} organisationId
 */
function predict(organisationId, windowDays = 7) {
  const orgIdStr = String(organisationId);
  // Calculate average number of open shifts per day from the last window
  const now = new Date();
  const pastDate = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  let openCount = 0;
  let dayCount = 0;
  db.shifts.forEach(s => {
    if (String(s.organisation_id) !== orgIdStr) return;
    const shiftDate = new Date(s.shift_date);
    if (shiftDate >= pastDate && shiftDate <= now) {
      dayCount++;
      if (s.status.toLowerCase() === 'open') openCount++;
    }
  });
  const avgOpenPerDay = dayCount > 0 ? openCount / dayCount : 0;
  const expectedOpenShifts = Math.round(avgOpenPerDay * windowDays);
  // Burnout risk: find staff with more than 5 assignments in last window or low wellbeing average
  const burnoutAlerts = [];
  db.staff.forEach(st => {
    if (String(st.organisation_id) !== orgIdStr) return;
    // Count assignments in window
    const assignments = db.shift_assignments.filter(sa => sa.staff_id === st.id);
    const recentAssign = assignments.filter(sa => {
      const dt = new Date(sa.accepted_at);
      return dt >= pastDate && dt <= now;
    });
    // Average wellbeing
    const staffSummaries = db.wellbeing_summaries.filter(ws => ws.staff_id === st.id);
    let sum = 0; let count = 0;
    staffSummaries.forEach(ws => { sum += ws.score; count++; });
    const avgW = count > 0 ? sum / count : 5;
    const risk = Math.min(1, (recentAssign.length / 6) * 0.6 + (5 - avgW) / 10);
    if (risk > 0.5) {
      burnoutAlerts.push({ staff: st.name, risk: Number(risk.toFixed(2)) });
    }
  });
  // Cost forecast: extrapolate from average payroll in last window
  let totalPay = 0; let payRecords = 0;
  db.payroll_records.forEach(pr => {
    if (String(pr.organisation_id) !== orgIdStr) return;
    const dt = new Date(pr.generated_at || pr.pay_period_end || pr.created_at);
    if (dt >= pastDate && dt <= now) {
      totalPay += pr.total_pay || 0;
      payRecords++;
    }
  });
  const avgPay = payRecords > 0 ? totalPay / payRecords : 0;
  const costForecast = Number((avgPay * (windowDays / (payRecords || 1))).toFixed(2));
  return {
    forecast_date: new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    expected_open_shifts: expectedOpenShifts,
    burnout_alerts: burnoutAlerts,
    cost_forecast: costForecast
  };
}

/**
 * Simulate a staffing change scenario.  Adjusts number of staff and
 * extra hours to compute new projections for wellbeing, cost and
 * coverage.  This is a simple model that applies linear adjustments.
 *
 * @param {string|number} organisationId
 * @param {Object} scenario
 */
function simulate(organisationId, scenario = {}) {
  const { ward, added_staff = 0, removed_staff = 0, extra_hours = 0 } = scenario;
  // Get baseline predictions
  const base = predict(organisationId);
  // Adjust expected open shifts: more staff reduces open shifts
  let adjustedOpen = base.expected_open_shifts - added_staff + removed_staff;
  if (adjustedOpen < 0) adjustedOpen = 0;
  // Adjust cost: additional staff increases cost linearly with extra hours and base pay
  const hourlyRate = parseFloat(process.env.BASE_RATE_DEFAULT || '12.10');
  const addedCost = (added_staff - removed_staff) * extra_hours * hourlyRate;
  const newCostForecast = Number((base.cost_forecast + addedCost).toFixed(2));
  // Adjust wellbeing: extra hours and staff changes impact score
  let wellbeingAdjustment = -(extra_hours * 0.05) + (added_staff * 0.1) - (removed_staff * 0.1);
  const avgWb = 5 + wellbeingAdjustment; // baseline neutral 5
  return {
    baseline: base,
    scenario: {
      expected_open_shifts: adjustedOpen,
      cost_forecast: newCostForecast,
      wellbeing_score: Number(avgWb.toFixed(2))
    }
  };
}

/**
 * Generate an AI narrative summary of predictions for an organisation.
 * Calls predict() internally and asks the OpenAI model to produce
 * recommendations.  Returns the AI text.
 *
 * @param {string|number} organisationId
 */
async function insight(organisationId) {
  const p = predict(organisationId);
  const prompt = `Provide a plain English summary and recommendations based on the following forecast: ` +
    `Expected open shifts: ${p.expected_open_shifts}, ` +
    `${p.burnout_alerts.length} staff flagged for burnout risk, ` +
    `cost forecast: £${p.cost_forecast}.`;
  try {
    const res = await analyzeTone(prompt);
    return { summary: res.tone_summary || '', details: p };
  } catch (err) {
    console.error('AI insight failed', err);
    return { summary: 'AI insight unavailable', details: p };
  }
}

module.exports = {
  generateSnapshot,
  predict,
  simulate,
  insight
};