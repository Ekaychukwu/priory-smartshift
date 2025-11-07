const { db, insertRecord } = require('../utils/db');

/**
 * Helper to compute payroll record for a given shift assignment.  Uses
 * environment variables for base rate and overtime multiplier.  The
 * hours worked are derived from the shift length (assumed 12 hours).
 * Contracted hours per day are computed by dividing the staff's
 * contracted hours per week by 5 (assuming a 5‑day work week).  Any
 * hours above this threshold are treated as overtime.
 *
 * @param {Object} assignment - A shift assignment {staff_id, shift_id, accepted_at}
 * @param {Object} staff - The staff record
 * @param {Object} shift - The shift record
 * @returns {Object} - A payroll record
 */
function computePayroll(assignment, staff, shift) {
  const rate = parseFloat(process.env.BASE_RATE_DEFAULT || '12.10');
  const multiplier = parseFloat(process.env.OVERTIME_MULTIPLIER || '1.5');
  const shiftStart = new Date(shift.shift_date);
  const shiftEnd = new Date(shiftStart.getTime() + 12 * 60 * 60 * 1000); // 12h shift including break
  // Compute hours worked: standard shift is 12 hours including a 1 hour break.
  // Staff are only paid for working hours (12 - 1 = 11).
  const hoursWorked = 11;
  // Daily contracted hours derived from weekly contracted hours.  A 37.5 hour
  // work week implies 7.5 hours per day (over 5 days).  Fall back to 7.5
  // if no staff record is available.
  const dailyContracted = staff && staff.contracted_hours_per_week ? staff.contracted_hours_per_week / 5 : 7.5;
  const overtimeHours = hoursWorked > dailyContracted ? hoursWorked - dailyContracted : 0;
  const grossPay = hoursWorked * rate;
  const overtimePay = overtimeHours * rate * multiplier;
  const totalPay = grossPay + overtimePay;
  // Determine pay period: default to monthly
  const periodDays = parseInt(process.env.PAY_PERIOD_DAYS || '30', 10);
  const payStart = new Date(shiftStart);
  payStart.setDate(1);
  const payEnd = new Date(payStart);
  payEnd.setDate(payStart.getDate() + periodDays - 1);
  return {
    staff_id: staff ? staff.id : assignment.staff_id,
    shift_id: shift.id,
    hours_worked: hoursWorked,
    rate_per_hour: rate,
    gross_pay: grossPay,
    overtime_hours: overtimeHours,
    overtime_pay: overtimePay,
    total_pay: totalPay,
    pay_period_start: payStart.toISOString().split('T')[0],
    pay_period_end: payEnd.toISOString().split('T')[0],
    approved: false,
    created_at: new Date().toISOString()
    ,organisation_id: shift.organisation_id
  };
}

/**
 * Generate payroll records for all assignments that have not yet been
 * processed.  This scans `shift_assignments` and checks whether a
 * corresponding record exists in `payroll_records`.  Only assignments
 * where the shift has ended (start + 12h < now) are processed.  The
 * function returns the newly created payroll records.
 */
function generatePayroll(organisationId = null) {
  const now = new Date();
  const newRecords = [];
  db.shift_assignments.forEach(assign => {
    // Skip if a payroll record already exists for this assignment
    const exists = db.payroll_records.find(pr => pr.staff_id === assign.staff_id && pr.shift_id === assign.shift_id);
    if (exists) return;
    const shift = db.shifts.find(s => s.id === assign.shift_id);
    if (!shift) return;
    // Filter by organisation
    if (organisationId && String(shift.organisation_id) !== String(organisationId)) return;
    const shiftStart = new Date(shift.shift_date);
    const shiftEnd = new Date(shiftStart.getTime() + 12 * 60 * 60 * 1000);
    if (now < shiftEnd) return; // shift not finished
    const staff = db.staff.find(s => s.id === assign.staff_id);
    const record = computePayroll(assign, staff, shift);
    const saved = insertRecord('payroll_records', record);
    newRecords.push(saved);
  });
  return newRecords;
}

/**
 * List payroll records with optional filtering by date range, staff or ward.
 * Query parameters: start_date, end_date, staff_id, ward.
 */
function listPayroll(filters = {}, organisationId = null) {
  return db.payroll_records.filter(pr => {
    if (organisationId && String(pr.organisation_id) !== String(organisationId)) return false;
    if (filters.start_date) {
      if (new Date(pr.created_at) < new Date(filters.start_date)) return false;
    }
    if (filters.end_date) {
      if (new Date(pr.created_at) > new Date(filters.end_date)) return false;
    }
    if (filters.staff_id) {
      if (String(pr.staff_id) !== String(filters.staff_id)) return false;
    }
    if (filters.ward) {
      const shift = db.shifts.find(s => s.id === pr.shift_id);
      if (!shift || shift.ward.toLowerCase() !== String(filters.ward).toLowerCase()) return false;
    }
    return true;
  });
}

/**
 * Get a single payroll record by id.
 */
function getPayroll(id, organisationId = null) {
  const record = db.payroll_records.find(pr => String(pr.id) === String(id));
  if (!record) return null;
  if (organisationId && String(record.organisation_id) !== String(organisationId)) return null;
  return record;
}

/**
 * Summarise payroll for a period.  Currently only supports period=monthly.
 * Returns aggregated hours, overtime and cost.
 */
function summaryPayroll(organisationId = null, period = 'monthly') {
  const summary = {};
  // Group by staff or ward?  We'll compute global summary and per ward.
  let totalHours = 0;
  let totalOvertime = 0;
  let totalCost = 0;
  const wardTotals = {};
  db.payroll_records.forEach(pr => {
    if (organisationId && String(pr.organisation_id) !== String(organisationId)) return;
    totalHours += pr.hours_worked;
    totalOvertime += pr.overtime_hours;
    totalCost += pr.total_pay;
    const shift = db.shifts.find(s => s.id === pr.shift_id);
    const ward = shift ? shift.ward : 'Unknown';
    if (!wardTotals[ward]) {
      wardTotals[ward] = { hours: 0, overtime: 0, cost: 0 };
    }
    wardTotals[ward].hours += pr.hours_worked;
    wardTotals[ward].overtime += pr.overtime_hours;
    wardTotals[ward].cost += pr.total_pay;
  });
  return {
    total_hours: totalHours,
    total_overtime: totalOvertime,
    total_cost: totalCost,
    wards: wardTotals
  };
}

module.exports = {
  generatePayroll,
  listPayroll,
  getPayroll,
  summaryPayroll
};