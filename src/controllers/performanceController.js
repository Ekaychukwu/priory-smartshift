const { db } = require('../utils/db');

/**
 * Get daily performance metrics aggregated by ward.  Calculates the
 * average punctuality and wellbeing scores for the current day.  For
 * wellbeing we use the most recent wellbeing_summaries for each staff.
 */
function getDailyPerformance(organisationId = null) {
  const today = new Date().toISOString().split('T')[0];
  const result = {};
  // Gather wellbeing scores by staff id for today
  const todaysSummaries = db.wellbeing_summaries.filter(w => w.date === today && (!organisationId || String(db.staff.find(s => s.id === w.staff_id)?.organisation_id) === String(organisationId)));
  const wellbeingByStaff = {};
  todaysSummaries.forEach(w => {
    wellbeingByStaff[w.staff_id] = w.score;
  });
  // For each staff member compute average metrics and group by ward (via current shift assignments)
  db.staff.forEach(staff => {
    if (organisationId && String(staff.organisation_id) !== String(organisationId)) return;
    // Determine ward based on most recent shift assignment, fallback to 'Unknown'
    const assignments = db.shift_assignments.filter(sa => sa.staff_id === staff.id);
    let ward = 'Unknown';
    if (assignments.length > 0) {
      const lastShift = db.shifts.find(s => s.id === assignments[assignments.length - 1].shift_id);
      ward = lastShift ? lastShift.ward : 'Unknown';
    }
    if (!result[ward]) {
      result[ward] = { punctuality: 0, wellbeing: 0, count: 0 };
    }
    // Punctuality score is derived from performance_metrics (if any) for today
    const metricsToday = db.performance_metrics.filter(pm => pm.staff_id === staff.id && pm.date === today && (!organisationId || String(pm.organisation_id) === String(organisationId)));
    const punctuality = metricsToday.reduce((sum, m) => sum + (m.punctuality_score || 0), 0) / (metricsToday.length || 1);
    const wellbeing = wellbeingByStaff[staff.id] ?? 0;
    result[ward].punctuality += punctuality;
    result[ward].wellbeing += wellbeing;
    result[ward].count += 1;
  });
  // Convert sums to averages
  const aggregated = {};
  Object.entries(result).forEach(([ward, data]) => {
    aggregated[ward] = {
      avg_punctuality: data.count ? (data.punctuality / data.count) : 0,
      avg_wellbeing: data.count ? (data.wellbeing / data.count) : 0
    };
  });
  return aggregated;
}

/**
 * Get performance trend for a single staff member over the last 30 days.
 * Returns arrays of dates and corresponding metrics.
 */
function getStaffPerformance(staffId, organisationId = null) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  // Collect metrics
  const records = db.performance_metrics
    .filter(pm => pm.staff_id === parseInt(staffId, 10) && (!organisationId || String(pm.organisation_id) === String(organisationId)))
    .filter(pm => new Date(pm.date) >= thirtyDaysAgo)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const dates = [];
  const punctuality = [];
  const completion = [];
  const wellbeing = [];
  records.forEach(r => {
    dates.push(r.date);
    punctuality.push(r.punctuality_score);
    completion.push(r.shift_completion_rate);
    // For wellbeing, if present in performance_metrics use it; otherwise
    // fallback to wellbeing_summaries
    if (typeof r.wellbeing_score !== 'undefined') {
      wellbeing.push(r.wellbeing_score);
    } else {
      const summary = db.wellbeing_summaries.find(w => w.staff_id === r.staff_id && w.date === r.date);
      wellbeing.push(summary ? summary.score : 0);
    }
  });
  return { dates, punctuality, completion, wellbeing };
}

/**
 * Leaderboard of top performing staff.  Sorts staff by their average
 * shift completion rate and punctuality over all recorded metrics.
 */
function getLeaderboard(organisationId = null) {
  const scores = {};
  db.performance_metrics.forEach(pm => {
    if (organisationId && String(pm.organisation_id) !== String(organisationId)) return;
    if (!scores[pm.staff_id]) {
      scores[pm.staff_id] = { totalCompletion: 0, totalPunctuality: 0, count: 0 };
    }
    scores[pm.staff_id].totalCompletion += (pm.shift_completion_rate || 0);
    scores[pm.staff_id].totalPunctuality += (pm.punctuality_score || 0);
    scores[pm.staff_id].count += 1;
  });
  const result = [];
  Object.entries(scores).forEach(([staffId, data]) => {
    const avgCompletion = data.totalCompletion / data.count;
    const avgPunctuality = data.totalPunctuality / data.count;
    result.push({ staff_id: parseInt(staffId, 10), avg_completion: avgCompletion, avg_punctuality: avgPunctuality });
  });
  // Sort by a simple combined score
  result.sort((a, b) => (b.avg_completion + b.avg_punctuality) - (a.avg_completion + a.avg_punctuality));
  return result;
}

module.exports = {
  getDailyPerformance,
  getStaffPerformance,
  getLeaderboard
};