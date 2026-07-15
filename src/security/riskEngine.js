/**
 * Accepts a numeric risk score and converts it into a severity level.
 * Severity thresholds:
 * - 80–100: critical
 * - 60–79: high
 * - 35–59: medium
 * - 1–34: low
 * - 0: none
 * @param {number} score - Risk score in the range of 0–100.
 * @returns {'none'|'low'|'medium'|'high'|'critical'} Risk severity level.
 */

function levelFromScore(score) {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

/**
 * Calculates the total risk score from an array of detected signals.
 * Each signal contains a `points` and `message` property. The total score is the sum of all `points` values.
 * The resulting score is clamped between 0 and 100.
 *
 * @param {{ points?: number, message?: string }[]} signals - Array of risk signals.
 * @returns {number} Total normalized risk score.
 */

function scoreSignals(signals) {
  return Math.max(0, Math.min(100, signals.reduce((t, s) => t + (s.points || 0), 0)));
}


/**
 * Creates a normalized risk assessment from an array of detected signals.
 *
 * The assessment contains:
 * - Total risk score
 * - Calculated severity level
 * - Signals containing a valid message
 *
 * @param {{ points?: number, message?: string }[]} signals - Detected risk signals.
 * @returns {{
 *   score: number,
 *   level: 'none'|'low'|'medium'|'high'|'critical',
 *   signals: { points?: number, message?: string }[]
 * }} Risk assessment object.
 */

function makeRisk(signals) {
  const score = scoreSignals(signals);
  return { score, level: levelFromScore(score), signals: signals.filter((s) => s && s.message) };
}

/**
 * Generates a human-readable recommendation based on a risk assessment.
 *
 * @param {{ score: number } | null | undefined} risk - Risk assessment object.
 * @param {string} [subject='item'] - Name of the optional object being evaluated.
 * @returns {string} Recommended action for the evaluated subject.
 */

function recommendationForRisk(risk, subject = 'item') {
  if (!risk || risk.score === 0) return 'No action needed.';
  if (risk.score >= 80) return `Quarantine or disable this ${subject} until it is verified.`;
  if (risk.score >= 60) return `Review this ${subject} before allowing it to continue running.`;
  if (risk.score >= 35) return `Inspect publisher, path, and purpose for this ${subject}.`;
  return `Keep this ${subject} under observation.`;
}


module.exports = { levelFromScore, scoreSignals, makeRisk, recommendationForRisk };