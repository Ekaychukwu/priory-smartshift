const { db, insertRecord } = require('../utils/db');
const { analyzeTone } = require('../services/openaiService');
const payrollController = require('./payrollController');
const performanceController = require('./performanceController');

// Helper to format a Date as YYYY-MM-DD in UTC
function toDateString(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Generate wellbeing summaries for each staff member.  This function
 * aggregates all messages from the last 24 hours (UTC) for each staff
 * from the wellbeing_logs table, uses the OpenAI API to summarise
 * emotional tone, calculates an average score, and writes the result
 * into the wellbeing_summaries table with today’s date.  Only users
 * with the 'admin' or 'manager' role should call this endpoint.
 *
 * @returns {Promise<Object>} - Object containing generated summaries
 */
async function generateSummaries(organisationId = null) {
  const summaries = [];
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const todayStr = toDateString(now);
  // For each staff member in the organisation
  for (const staff of db.staff) {
    if (organisationId && String(staff.organisation_id) !== String(organisationId)) continue;
    // Gather messages from the last 24h
    const logs = db.wellbeing_logs.filter(log => log.staff_id === staff.id && new Date(log.timestamp) >= yesterday);
    if (logs.length === 0) {
      // No messages: skip or create neutral summary
      const summaryRecord = insertRecord('wellbeing_summaries', {
        staff_id: staff.id,
        summary: 'No recent messages.',
        score: 5,
        date: todayStr,
        organisation_id: staff.organisation_id
      });
      summaries.push(summaryRecord);
      continue;
    }
    // Concatenate messages for summarisation
    const combinedText = logs.map(l => l.message).join(' | ');
    // Call OpenAI to summarise tone of combined text
    let tone;
    try {
      tone = await analyzeTone(combinedText);
    } catch (err) {
      console.error('AI analysis error', err);
      tone = { tone_summary: 'unknown', score: 5 };
    }
    // Calculate average score from individual logs if available; otherwise use tone.score
    const avgScore = logs.reduce((acc, l) => acc + (l.score || 5), 0) / logs.length;
    const finalScore = tone.score ? (tone.score + avgScore) / 2 : avgScore;
    const summaryRecord = insertRecord('wellbeing_summaries', {
      staff_id: staff.id,
      summary: tone.tone_summary,
      score: parseFloat(finalScore.toFixed(2)),
      date: todayStr,
      organisation_id: staff.organisation_id
    });
    summaries.push(summaryRecord);
  }
  return { summaries };
}

/**
 * Retrieve wellbeing summaries for the current date (UTC).  Returns an
 * array of summaries keyed by staff_id.
 */
function getTodaySummaries(organisationId = null) {
  const todayStr = toDateString(new Date());
  const todaySummaries = db.wellbeing_summaries.filter(ws => ws.date === todayStr && (!organisationId || String(ws.organisation_id) === String(organisationId)));
  return todaySummaries;
}

module.exports = {
  generateSummaries,
  getTodaySummaries,
  autoClosePayroll,
  payrollSummary
};

/**
 * Automatically close payroll for completed shifts.  This wraps the
 * payrollController.generatePayroll() method so it can be called via
 * an AI/cron endpoint.  Returns the new payroll records.
 */
function autoClosePayroll(organisationId = null) {
  const newRecords = payrollController.generatePayroll(organisationId);
  return { created: newRecords.length, records: newRecords };
}

/**
 * Generate a natural language summary of payroll and performance data.
 * Aggregates the latest payroll summary and daily performance
 * statistics and passes a prompt to the OpenAI API to produce a
 * short narrative.  If the OpenAI API is unavailable, returns a
 * structured summary instead.
 */
async function payrollSummary(organisationId = null) {
  const payrollSumm = payrollController.summaryPayroll(organisationId);
  const performance = performanceController.getDailyPerformance(organisationId);
  // Build a plain text summary for AI
  let prompt = `Summarise the following workforce statistics in a concise paragraph.\n`;
  prompt += `Total hours worked: ${payrollSumm.total_hours}. Total overtime hours: ${payrollSumm.total_overtime}. Total cost: £${payrollSumm.total_cost.toFixed(2)}.\n`;
  prompt += `Ward breakdown: `;
  Object.entries(payrollSumm.wards).forEach(([ward, data]) => {
    prompt += `${ward}: ${data.hours} hours, £${data.cost.toFixed(2)} cost; `;
  });
  prompt += `\nDaily performance averages by ward: `;
  Object.entries(performance).forEach(([ward, metrics]) => {
    prompt += `${ward}: wellbeing ${metrics.avg_wellbeing.toFixed(1)}, punctuality ${metrics.avg_punctuality.toFixed(1)}; `;
  });
  try {
    const tone = await analyzeTone(prompt);
    return { summary: tone.tone_summary, score: tone.score, prompt };
  } catch (err) {
    // If AI fails, return raw data
    return { summary: 'AI unavailable', data: { payroll: payrollSumm, performance } };
  }
}