const { db, insertRecord, updateRecord } = require('../utils/db');
const { hashPassword, verifyPassword, signJwt } = require('../utils/auth');

// Register a new user.  Expects body with name, email, password and role.
// Returns an object with the created user (without password_hash) and a JWT.
async function register(body) {
  const { name, email, password, role = 'staff', organisation_id, org_subdomain } = body;
  if (!name || !email || !password) {
    return { error: 'Name, email and password are required' };
  }
  const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    return { error: 'User with this email already exists' };
  }
  const password_hash = hashPassword(password);
  // Determine organisation.  If org_subdomain or organisation_id is provided,
  // look up the organisation.  Otherwise default to the first organisation.
  let orgId = organisation_id;
  if (!orgId && org_subdomain) {
    const org = db.organisations.find(o => o.subdomain === org_subdomain);
    if (!org) {
      return { error: 'Invalid organisation' };
    }
    orgId = org.id;
  }
  if (!orgId) {
    orgId = db.organisations.length > 0 ? db.organisations[0].id : 1;
  }
  // For staff and manager roles, create or link to a staff record.  A real
  // system might require additional fields (phone number, preferred shift).
  let staff_id = null;
  if (role === 'staff' || role === 'manager') {
    // Create a basic staff record with the user's name and default values.
    const staffRecord = insertRecord('staff', {
      name,
      phone_number: '',
      preferred_shift: 'Day',
      wellbeing_score: 0
      ,organisation_id: orgId
    });
    staff_id = staffRecord.id;
  }
  const newUser = insertRecord('users', {
    name,
    email: email.toLowerCase(),
    password_hash,
    role,
    staff_id,
    organisation_id: orgId
  });
  const token = signJwt({ id: newUser.id, role: newUser.role, organisation_id: orgId }, process.env.JWT_SECRET || 'secret');
  const { password_hash: _, ...userWithoutHash } = newUser;
  return { user: userWithoutHash, token };
}

// Login an existing user.  Expects body with email and password.  Returns
// {user, token} on success or {error} on failure.
async function login(body) {
  const { email, password, org_subdomain } = body;
  if (!email || !password) {
    return { error: 'Email and password are required' };
  }
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return { error: 'Invalid credentials' };
  }
  const valid = verifyPassword(password, user.password_hash);
  if (!valid) {
    return { error: 'Invalid credentials' };
  }
  // If an org_subdomain is provided, ensure it matches the user's organisation.
  if (org_subdomain) {
    const org = db.organisations.find(o => o.subdomain === org_subdomain);
    if (!org || user.organisation_id !== org.id) {
      return { error: 'Invalid organisation' };
    }
  }
  const token = signJwt({ id: user.id, role: user.role, organisation_id: user.organisation_id }, process.env.JWT_SECRET || 'secret');
  const { password_hash: _, ...userWithoutHash } = user;
  return { user: userWithoutHash, token };
}

// Return the current authenticated user's profile.  Requires req.user to be
// set by authentication middleware.  Returns {user} or {error} if no user.
function profile(req) {
  const authUser = req.user;
  if (!authUser) {
    return { error: 'Unauthorised' };
  }
  const user = db.users.find(u => u.id === authUser.id);
  if (!user) return { error: 'User not found' };
  const { password_hash: _, ...userWithoutHash } = user;
  return { user: userWithoutHash };
}

// Simulate password reset by printing a reset link to the console.  Returns
// a generic success message.  In a real application you would send an
// email containing a one-time token.
async function resetPassword(body) {
  const { email } = body;
  if (!email) return { error: 'Email is required' };
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return { error: 'No account found for this email' };
  }
  const resetToken = Math.random().toString(36).substring(2);
  console.log(`Password reset token for ${email}: ${resetToken}`);
  return { message: 'Password reset instructions have been sent (simulated).' };
}

module.exports = {
  register,
  login,
  profile,
  resetPassword
};