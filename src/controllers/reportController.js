const fs = require('fs');
const path = require('path');
const { db, insertRecord, save } = require('../utils/db');
const { analyzeTone } = require('../services/openaiService');

/**
 * Calculate compliance and wellbeing metrics for a given organisation and
 * time period.  This function summarises open vs filled shifts,
 * staffing ratios, overtime hours, average wellbeing scores and other
 * indicators.  It returns an object containing the metrics.
 *
 * @param {string|number} organisationId
 * @param {Date} startDate
 * @param {Date} endDate
 */
function calculateMetrics(organisationId, startDate, endDate) {
  const orgIdStr = String(organisationId);
  // Filter shifts in the organisation
  const shifts = db.shifts.filter(s => String(s.organisation_id) === orgIdStr);
  const openCount = shifts.filter(s => s.status.toLowerCase() === 'open').length;
  const filledCount = shifts.filter(s => s.status.toLowerCase() === 'filled').length;
  const totalShifts = shifts.length;
  const complianceRate = totalShifts > 0 ? ((filledCount / totalShifts) * 100).toFixed(1) : '0.0';
  // Compute staff ratio (Nurse vs HCA).  Count role_required occurrences
  let nurseCount = 0;
  let hcaCount = 0;
  shifts.forEach(s => {
    const role = s.role_required.toLowerCase();
    if (role.includes('nurse') || role.includes('rn')) nurseCount++;
    if (role.includes('hca') || role.includes('assistant')) hcaCount++;
  });
  const staffRatio = hcaCount > 0 ? (nurseCount / hcaCount).toFixed(2) : 'N/A';
  // Overtime hours from payroll_records within period
  let totalOvertimeHours = 0;
  let totalHours = 0;
  db.payroll_records.forEach(pr => {
    if (String(pr.organisation_id) !== orgIdStr) return;
    const created = new Date(pr.created_at || pr.generated_at || pr.pay_period_end);
    if (created >= startDate && created <= endDate) {
      totalOvertimeHours += pr.overtime_hours || 0;
      totalHours += pr.hours_worked || 0;
    }
  });
  const overtimeRate = totalHours > 0 ? ((totalOvertimeHours / totalHours) * 100).toFixed(1) : '0.0';
  // Average wellbeing score per ward from wellbeing_summaries.  We
  // aggregate by staff then map staff to ward via their last shift.
  const wellbeingMap = {};
  db.wellbeing_summaries.forEach(ws => {
    const date = new Date(ws.date || ws.timestamp);
    if (date >= startDate && date <= endDate) {
      const staffId = ws.staff_id;
      if (!wellbeingMap[staffId]) wellbeingMap[staffId] = [];
      wellbeingMap[staffId].push(ws.score);
    }
  });
  let wellbeingSum = 0;
  let wellbeingCount = 0;
  Object.values(wellbeingMap).forEach(scores => {
    scores.forEach(sc => { wellbeingSum += sc; wellbeingCount++; });
  });
  const avgWellbeing = wellbeingCount > 0 ? (wellbeingSum / wellbeingCount).toFixed(1) : '-';
  // Placeholder training completion percentage (simulate random value)
  const trainingCompletion = 0.95; // 95%
  return {
    totalShifts,
    filledCount,
    openCount,
    complianceRate,
    staffRatio,
    totalHours,
    totalOvertimeHours,
    overtimeRate,
    avgWellbeing,
    trainingCompletion
  };
}

/**
 * Generate a compliance/wellbeing report for the specified organisation and
 * type (weekly or monthly).  Creates a summary string, calls the AI
 * engine for a narrative, writes a plain text file, stores a record in
 * the reports table and returns the record.
 *
 * @param {string|number} organisationId
 * @param {string} type - 'weekly' or 'monthly'
 */
async function generateReport(organisationId, type = 'weekly') {
  // Determine period start/end
  const now = new Date();
  let startDate;
  if (type === 'monthly') {
    // first day of current month
    startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else {
    // weekly: start 7 days ago
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  const endDate = now;
  // Calculate metrics
  const metrics = calculateMetrics(organisationId, startDate, endDate);
  // Build a narrative using AI (optional).  We'll pass a summary of
  // metrics to the model with a fixed prompt.
  let aiSummary = '';
  try {
    const prompt = `Summarise this organisation’s ${type} staffing performance and wellbeing trends in plain English.\n` +
                   `Total shifts: ${metrics.totalShifts}, Filled: ${metrics.filledCount}, Open: ${metrics.openCount}, Compliance rate: ${metrics.complianceRate}%.\n` +
                   `Staff ratio (RN/HCA): ${metrics.staffRatio}. Overtime hours: ${metrics.totalOvertimeHours}, Overtime rate: ${metrics.overtimeRate}%.\n` +
                   `Average wellbeing score: ${metrics.avgWellbeing}. Training completion: ${(metrics.trainingCompletion * 100).toFixed(0)}%.`;
    const aiResult = await analyzeTone(prompt);
    aiSummary = aiResult.tone_summary || '';
  } catch (err) {
    console.error('AI summary failed', err);
    aiSummary = 'AI summary unavailable';
  }
  // Compose report content
  const lines = [];
  lines.push(`Priory SmartShift ${type.charAt(0).toUpperCase() + type.slice(1)} Report`);
  lines.push(`Organisation ID: ${organisationId}`);
  lines.push(`Generated at: ${now.toISOString()}`);
  lines.push(`Period: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  lines.push('');
  lines.push(`Total shifts: ${metrics.totalShifts}`);
  lines.push(`Filled shifts: ${metrics.filledCount}`);
  lines.push(`Open shifts: ${metrics.openCount}`);
  lines.push(`Compliance rate: ${metrics.complianceRate}%`);
  lines.push(`Staff ratio (RN/HCA): ${metrics.staffRatio}`);
  lines.push(`Total hours: ${metrics.totalHours}`);
  lines.push(`Overtime hours: ${metrics.totalOvertimeHours}`);
  lines.push(`Overtime rate: ${metrics.overtimeRate}%`);
  lines.push(`Average wellbeing: ${metrics.avgWellbeing}`);
  lines.push(`Training completion: ${(metrics.trainingCompletion * 100).toFixed(0)}%`);
  lines.push('');
  lines.push('AI Summary & Recommendations:');
  lines.push(aiSummary);
  const content = lines.join('\n');
  // Ensure reports directory exists
  const reportsDir = path.join(__dirname, '../../reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);
  // Write plain text file with .txt extension
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const filename = `${type}-report-${organisationId}-${timestamp}.txt`;
  const filePath = path.join(reportsDir, filename);
  fs.writeFileSync(filePath, content);
  // Insert record into database
  const reportRecord = insertRecord('reports', {
    organisation_id: organisationId,
    report_type: type,
    generated_at: now.toISOString(),
    report_period_start: startDate.toISOString(),
    report_period_end: endDate.toISOString(),
    file_url: filePath,
    emailed_to: '',
    status: 'generated'
  });
  return reportRecord;
}

/**
 * List reports for an organisation
 */
function listReports(organisationId) {
  return db.reports.filter(r => String(r.organisation_id) === String(organisationId));
}

/**
 * Get a single report record by ID for a given organisation
 */
function getReport(organisationId, id) {
  const rep = db.reports.find(r => String(r.id) === String(id) && String(r.organisation_id) === String(organisationId));
  return rep || null;
}

/**
 * Send a report via email to all admin and manager users in the same
 * organisation.  This function logs the action instead of sending
 * real emails.  In a real implementation you would integrate
 * SendGrid or another mail provider here.
 *
 * @param {string|number} organisationId
 * @param {string|number} reportId
 */
async function sendReport(organisationId, reportId) {
  const report = getReport(organisationId, reportId);
  if (!report) return { error: 'Report not found' };
  // Find recipients: all admin and manager users in the organisation
  const recipients = db.users.filter(u => String(u.organisation_id) === String(organisationId) && (u.role === 'admin' || u.role === 'manager'));
  const emails = recipients.map(u => u.email);
  // Simulate sending email
  console.log(`Sending report ${reportId} to ${emails.join(', ')}`);
  // Update report record
  report.status = 'sent';
  report.emailed_to = emails.join(',');
  save();
  return { message: 'Report sent', reportId, recipients: emails };
}

module.exports = {
  generateReport,
  listReports,
  getReport,
  sendReport
};