const { db } = require('../utils/db');

/**
 * Return dashboard data for a given staff member.  Requires authentication.
 * Staff members can only access their own data.  Managers and admins can
 * access any staff member's data.
 *
 * @param {Object} req - The HTTP request object with req.user set
 * @param {string|number} staffIdParam - Staff ID from the route parameter
 * @returns {Object} - Dashboard data or error message
 */
function getStaffDashboard(req, staffIdParam, organisationId = null) {
  const staffId = parseInt(staffIdParam, 10);
  if (isNaN(staffId)) {
    return { error: 'Invalid staff ID' };
  }
  const authUser = req.user;
  if (!authUser) {
    return { error: 'Unauthorised' };
  }
  // If requester is a staff member, restrict access to their own data
  if (authUser.role === 'staff' && authUser.staff_id !== staffId) {
    return { error: 'Forbidden' };
  }
  // Ensure the staff exists
  const staff = db.staff.find(s => s.id === staffId);
  if (!staff) {
    return { error: 'Staff not found' };
  }
  // Enforce organisation scope: the staff must belong to the requested org
  if (organisationId && String(staff.organisation_id) !== String(organisationId)) {
    return { error: 'Forbidden' };
  }
  // Open shifts available to accept
  const available_shifts = db.shifts.filter(s => s.status.toLowerCase() === 'open' && (!organisationId || String(s.organisation_id) === String(organisationId)));
  // Accepted shifts for this staff
  const acceptedAssignments = db.shift_assignments.filter(sa => sa.staff_id === staffId && (!organisationId || String(sa.organisation_id) === String(organisationId)));
  const accepted_shifts = acceptedAssignments.map(sa => {
    const shift = db.shifts.find(s => s.id === sa.shift_id);
    return shift || null;
  }).filter(Boolean);
  // Calculate cumulative hours: each shift is 12h including a 1h unpaid break
  // resulting in 11 paid hours.
  const cumulative_hours = accepted_shifts.length * 11;
  // Upcoming schedule: sort accepted shifts by date
  const upcoming_schedule = accepted_shifts.sort((a, b) => new Date(a.shift_date) - new Date(b.shift_date));
  // Wellbeing history: get summaries for this staff, sorted by date descending
  const wellbeing_history = db.wellbeing_summaries
    .filter(w => w.staff_id === staffId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return {
    staff: { id: staff.id, name: staff.name, preferred_shift: staff.preferred_shift },
    available_shifts,
    accepted_shifts,
    cumulative_hours,
    upcoming_schedule,
    wellbeing_history
  };
}

module.exports = {
  getStaffDashboard
};