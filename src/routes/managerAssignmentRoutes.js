'use strict';

/**
 * Manager assignment routes
 *
 * These routes expose the shift assignment engine so a manager can
 * request “best staff” recommendations for a given shift.
 */

const express = require('express');
const router = express.Router();

const { getBestStaffForShift } = require('../services/shiftAssignmentEngine');

// GET /api/manager/assign/shift/:shiftId/recommendations
// Requires a valid JWT (handled by global auth middleware in index.js)
router.get('/shift/:shiftId/recommendations', async (req, res) => {
  try {
    // 1) Get and validate shiftId from URL
    const shiftIdRaw = req.params.shiftId;
    const shiftId = parseInt(shiftIdRaw, 10);

    if (Number.isNaN(shiftId) || shiftId <= 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid shift id: ${shiftIdRaw}`,
      });
    }

    // 2) Get organisation_id from the JWT user object
    //    This comes from authMiddleware and is already trusted.
    const organisationId = req.user && req.user.organisation_id
      ? req.user.organisation_id
      : 1; // fallback to 1 for safety in dev

    // IMPORTANT:
    // We pass organisationId as a PLAIN NUMBER,
    // NOT as an object like { organisationId }.
    const result = await getBestStaffForShift(shiftId, organisationId, {
      limit: 5,
    });

    return res.json({
      success: true,
      shift: result.shift,
      top_recommendations: result.topRecommendations,
      all_ranked: result.allRanked,
    });
  } catch (err) {
    console.error('[ASSIGNMENT] Error in /shift/:shiftId/recommendations:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to compute shift assignment recommendations.',
    });
  }
});

module.exports = router;