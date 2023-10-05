const ERR = require('async-stacktrace');
const _ = require('lodash');

const { config } = require('./config');
const { checkSignedToken } = require('@prairielearn/signed-token');
const question = require('./question');
const { logger } = require('@prairielearn/logger');
const socketServer = require('./socket-server');
const sqldb = require('@prairielearn/postgres');

const sql = sqldb.loadSqlEquiv(__filename);

module.exports = {};

// This module MUST be initialized after socket-server
module.exports.init = function (callback) {
  module.exports._namespace = socketServer.io.of('/external-grading');
  module.exports._namespace.on('connection', module.exports.connection);

  callback(null);
};

module.exports.connection = function (socket) {
  socket.on('init', (msg, callback) => {
    if (!ensureProps(msg, ['variant_id', 'variant_token'])) {
      logger.error('External grading socket error: init: missing props', msg);
      return callback(null);
    }
    if (!checkToken(msg.variant_token, msg.variant_id)) {
      logger.error('External grading socket error: init: invalid token', msg);
      return callback(null);
    }

    socket.join(`variant-${msg.variant_id}`);

    module.exports.getVariantSubmissionsStatus(msg.variant_id, (err, submissions) => {
      if (
        ERR(err, (err) =>
          logger.error(
            'External grading socket error: init: Error getting variant submissions status',
            { msg, err },
          ),
        )
      )
        return;
      callback({ variant_id: msg.variant_id, submissions });
    });
  });

  socket.on('getResults', (msg, callback) => {
    if (
      !ensureProps(msg, [
        'question_id',
        'instance_question_id',
        'variant_id',
        'variant_token',
        'submission_id',
        'url_prefix',
        'question_context',
        'csrf_token',
      ])
    ) {
      logger.error('External grading socket error: getResults: missing props', msg);
      return callback(null);
    }
    if (!checkToken(msg.variant_token, msg.variant_id)) {
      logger.error('External grading socket error: getResults: invalid token', msg);
      return callback(null);
    }

    module.exports.renderPanelsForSubmission(
      msg.submission_id,
      msg.question_id,
      msg.instance_question_id,
      msg.variant_id,
      msg.url_prefix,
      msg.question_context,
      msg.csrf_token,
      msg.authorized_edit,
      (err, panels) => {
        if (
          ERR(err, (err) =>
            logger.error(
              'External grading socket error: getResults: Error rendering panels for submission',
              err,
            ),
          )
        )
          return;
        callback({
          submission_id: msg.submission_id,
          answerPanel: panels.answerPanel,
          submissionPanel: panels.submissionPanel,
          questionScorePanel: panels.questionScorePanel,
          assessmentScorePanel: panels.assessmentScorePanel,
          questionPanelFooter: panels.questionPanelFooter,
          questionNavNextButton: panels.questionNavNextButton,
        });
      },
    );
  });

  socket.onAnyOutgoing((event, ...args) => {
    logger.verbose('External grading socket: outgoing packet', { event, args });
  });
};

module.exports.getVariantSubmissionsStatus = function (variant_id, callback) {
  const params = {
    variant_id,
  };
  sqldb.query(sql.select_submissions_for_variant, params, (err, result) => {
    if (ERR(err, callback)) return;
    callback(null, result.rows);
  });
};

module.exports.gradingJobStatusUpdated = function (grading_job_id) {
  const params = { grading_job_id };
  sqldb.queryOneRow(sql.select_submission_for_grading_job, params, (err, result) => {
    if (
      ERR(err, (err) =>
        logger.error(
          'External grading socket error: Error selecting submission for grading job',
          err,
        ),
      )
    )
      return;
    const eventData = {
      variant_id: result.rows[0].variant_id,
      submissions: result.rows,
    };
    logger.verbose('External grading socket: gradingJobStatusUpdated', {
      grading_job_id,
      eventData,
    });
    module.exports._namespace
      .to(`variant-${result.rows[0].variant_id}`)
      .emit('change:status', eventData);
  });
};

module.exports.renderPanelsForSubmission = function (
  submission_id,
  question_id,
  instance_question_id,
  variant_id,
  urlPrefix,
  questionContext,
  csrfToken,
  authorizedEdit,
  callback,
) {
  question.renderPanelsForSubmission(
    submission_id,
    question_id,
    instance_question_id,
    variant_id,
    urlPrefix,
    questionContext,
    csrfToken,
    authorizedEdit,
    true, // renderScorePanels
    (err, results) => {
      if (ERR(err, callback)) return;
      callback(null, results);
    },
  );
};

function ensureProps(data, props) {
  for (const prop of props) {
    if (!_.has(data, prop)) {
      logger.error(`socket.io external grader connected without ${prop}`);
      return false;
    }
  }
  return true;
}

function checkToken(token, variantId) {
  const data = {
    variantId,
  };
  const valid = checkSignedToken(token, data, config.secretKey, {
    maxAge: 24 * 60 * 60 * 1000,
  });
  if (!valid) {
    logger.error(`CSRF token for variant ${variantId} failed validation.`);
  }
  return valid;
}
