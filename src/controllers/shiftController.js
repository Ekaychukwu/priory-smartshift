const { db, updateRecord } = require('../utils/db');

/**
 * List all shifts in the system with optional filtering.  Filters can be
 * provided via query parameters: `status`, `ward` and `role`.  Matching
 * is case-insensitive.  If no filters are provided all shifts are returned.
 *
 * @param {Object} filters - Query parameters from the HTTP request
 * @returns {Array} - Array of shift objects
 */
function listShifts(filters = {}, organisationId = null) {
  return db.shifts.filter(shift => {
    if (organisationId && String(shift.organisation_id) !== String(organisationId)) {
      return false;
    }
    if (filters.status && shift.status.toLowerCase() !== filters.status.toLowerCase()) {
      return false;
    }
    if (filters.ward && shift.ward.toLowerCase() !== filters.ward.toLowerCase()) {
      return false;
    }
    if (filters.role && shift.role_required.toLowerCase() !== filters.role.toLowerCase()) {
      return false;
    }
    return true;
  });
}

/**
 * Accept or fill a shift by its ID.  If a user object is provided and the
 * user has the role `staff` or `manager`, the function treats the
 * acceptance as a staff action: it records an assignment, enforces
 * consecutive shift rules and day/night restrictions, and increments
 * `number_filled`.  When the required number is reached the shift is
 * marked as filled.  If the user has the role `admin` or no user is
 * provided, the shift is simply marked as filled without assigning any
 * staff.
 *
 * @param {string|number} id - ID of the shift to update
 * @param {Object|null} user - Authenticated user performing the action
 * @returns {Object} - Result of the operation
 */
function acceptShiftById(id, user = null, organisationId = null) {
  const shift = db.shifts.find(s => String(s.id) === String(id));
  if (!shift) {
    return { error: 'Shift not found' };
  }
  // Ensure the shift belongs to the requested organisation if orgId provided
  if (organisationId && String(shift.organisation_id) !== String(organisationId)) {
    return { error: 'Forbidden' };
  }
  // If no user or user is admin, mark the shift as filled immediately
  if (!user || user.role === 'admin') {
    if (shift.status === 'Filled') {
      return { message: 'Shift already marked as filled' };
    }
    updateRecord('shifts', shift.id, {
      status: 'Filled',
      number_filled: shift.number_required
    });
    return { message: `Shift ${shift.shift_ref} marked as filled.` };
  }
  // Only staff or managers can accept shifts for themselves.  Managers may
  // also accept shifts on behalf of staff if they have a `staff_id` set.
  if (user.role !== 'staff' && user.role !== 'manager') {
    return { error: 'Forbidden' };
  }
  // Determine which staff record to assign.  Managers must have
  // user.staff_id set if they are accepting for themselves; otherwise
  // return an error.  In a more complete system managers could specify
  // which staff member to assign but for simplicity we only allow self‑assign.
  const staffId = user.staff_id;
  if (!staffId) {
    return { error: 'User is not linked to a staff record' };
  }
  // Ensure shift still has available spots
  if (shift.status === 'Filled' || shift.number_filled >= shift.number_required) {
    return { error: 'Shift already filled' };
  }
  // Enforce maximum of 6 consecutive accepted shifts per staff member.
  const assignments = db.shift_assignments
    .filter(sa => sa.staff_id === staffId)
    .sort((a, b) => new Date(a.accepted_at) - new Date(b.accepted_at));
  if (assignments.length >= 6) {
    return { error: 'Too many consecutive shifts. Please take a break.' };
  }
  // Enforce day/night rule: cannot work both day and night shifts consecutively
  if (assignments.length > 0) {
    const lastAssignment = assignments[assignments.length - 1];
    const lastShift = db.shifts.find(s => s.id === lastAssignment.shift_id);
    if (lastShift) {
      const lastDate = new Date(lastShift.shift_date);
      const newDate = new Date(shift.shift_date);
      const hoursDiff = Math.abs(newDate - lastDate) / 36e5;
      const lastIsDay = lastDate.getUTCHours() < 12;
      const newIsDay = newDate.getUTCHours() < 12;
      if (hoursDiff < 12 && lastIsDay !== newIsDay) {
        return { error: 'Cannot work day and night shifts consecutively. Please allow 12 hours between shifts.' };
      }
    }
  }
  // Record the assignment
  db.shift_assignments.push({
    staff_id: staffId,
    shift_id: shift.id,
    accepted_at: new Date().toISOString(),
    organisation_id: shift.organisation_id
  });
  // Increment filled count and update status if necessary
  const newFilled = shift.number_filled + 1;
  updateRecord('shifts', shift.id, {
    number_filled: newFilled,
    status: newFilled >= shift.number_required ? 'Filled' : shift.status
  });
  return { message: `Shift ${shift.shift_ref} accepted.` };
}

module.exports = {
  listShifts,
  acceptShiftById
};