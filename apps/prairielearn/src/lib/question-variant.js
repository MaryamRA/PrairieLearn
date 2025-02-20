// @ts-check

const ERR = require('async-stacktrace');
const _ = require('lodash');
import * as path from 'path';
import debugfn from 'debug';
import * as fg from 'fast-glob';
import * as util from 'util';
import { workspaceFastGlobDefaultOptions } from '@prairielearn/workspace-utils';

import * as sqldb from '@prairielearn/postgres';
import * as questionServers from '../question-servers';
import { writeCourseIssues } from './issues';
import { selectCourseById } from '../models/course';
import { selectQuestionById, selectQuestionByInstanceQuestionId } from '../models/question';

const debug = debugfn('prairielearn:' + path.basename(__filename, '.js'));

/**
 * Internal function, do not call directly. Create a variant object, do not write to DB.
 * @protected
 *
 * @param {Object} question - The question for the variant.
 * @param {Object} course - The course for the question.
 * @param {Object} options - Options controlling the creation: options = {variant_seed}
 * @param {function} callback - A callback(err, courseIssues, variant) function.
 */
function makeVariant(question, course, options, callback) {
  debug('_makeVariant()');
  var variant_seed;
  if (_(options).has('variant_seed') && options.variant_seed != null) {
    variant_seed = options.variant_seed;
  } else {
    variant_seed = Math.floor(Math.random() * Math.pow(2, 32)).toString(36);
  }
  debug(`_makeVariant(): question_id = ${question.id}`);
  questionServers.getModule(question.type, (err, questionModule) => {
    if (ERR(err, callback)) return;
    questionModule.generate(question, course, variant_seed, (err, courseIssues, data) => {
      if (ERR(err, callback)) return;
      const hasFatalIssue = _.some(_.map(courseIssues, 'fatal'));
      var variant = {
        variant_seed: variant_seed,
        params: data.params || {},
        true_answer: data.true_answer || {},
        options: data.options || {},
        broken: hasFatalIssue,
      };
      if (question.workspace_image !== null) {
        // if workspace, add graded files to params
        variant.params['_workspace_required_file_names'] = (
          question.workspace_graded_files || []
        ).filter((file) => !fg.isDynamicPattern(file, workspaceFastGlobDefaultOptions));
        if (!('_required_file_names' in variant.params)) {
          variant.params['_required_file_names'] = [];
        }
        variant.params['_required_file_names'] = variant.params['_required_file_names'].concat(
          variant.params['_workspace_required_file_names'],
        );
      }
      if (variant.broken) {
        return callback(null, courseIssues, variant);
      }
      questionModule.prepare(question, course, variant, (err, extraCourseIssues, data) => {
        if (ERR(err, callback)) return;
        courseIssues.push(...extraCourseIssues);
        const hasFatalIssue = _.some(_.map(courseIssues, 'fatal'));
        var variant = {
          variant_seed: variant_seed,
          params: data.params || {},
          true_answer: data.true_answer || {},
          options: data.options || {},
          broken: hasFatalIssue,
        };
        callback(null, courseIssues, variant);
      });
    });
  });
}

/**
 * Get a file that is generated by code.
 *
 * @param {String} filename
 * @param {Object} variant - The variant.
 * @param {Object} question - The question for the variant.
 * @param {Object} variant_course - The course for the variant.
 * @param {string} authn_user_id - The current authenticated user.
 * @param {function} callback - A callback(err, fileData) function.
 */
export function getFile(filename, variant, question, variant_course, authn_user_id, callback) {
  questionServers.getModule(question.type, (err, questionModule) => {
    if (ERR(err, callback)) return;
    util.callbackify(getQuestionCourse)(question, variant_course, (err, question_course) => {
      if (ERR(err, callback)) return;
      questionModule.file(
        filename,
        variant,
        question,
        question_course,
        (err, courseIssues, fileData) => {
          if (ERR(err, callback)) return;

          const studentMessage = 'Error creating file: ' + filename;
          const courseData = { variant, question, course: variant_course };
          writeCourseIssues(
            courseIssues,
            variant,
            authn_user_id,
            studentMessage,
            courseData,
            (err) => {
              if (ERR(err, callback)) return;

              return callback(null, fileData);
            },
          );
        },
      );
    });
  });
}

/**
 * Internal function, do not call directly. Get a question by either question_id or instance_question_id.
 * @protected
 *
 * @param {string |  null} question_id - The question for the new variant. Can be null if instance_question_id is provided.
 * @param {string | null} instance_question_id - The instance question for the new variant. Can be null if question_id is provided.
 * @returns {Promise<import('./db-types').Question>}
 */
async function selectQuestion(question_id, instance_question_id) {
  if (question_id != null) {
    return await selectQuestionById(question_id);
  } else if (instance_question_id != null) {
    return await selectQuestionByInstanceQuestionId(instance_question_id);
  } else {
    throw new Error('question_id and instance_question_id cannot both be null');
  }
}

/**
 * Internal function, do not call directly. Create a variant object, and write it to the DB.
 * @protected
 *
 * @param {?string} question_id - The question for the new variant. Can be null if instance_question_id is provided.
 * @param {?string} instance_question_id - The instance question for the new variant, or null for a floating variant.
 * @param {string} user_id - The user for the new variant.
 * @param {string} authn_user_id - The current authenticated user.
 * @param {boolean} group_work - If the assessment will support group work.
 * @param {Object} variant_course - The course for the variant.
 * @param {Object} question_course - The course for the question.
 * @param {Object} options - Options controlling the creation: options = {variant_seed}
 * @param {function} callback - A callback(err, variant) function.
 */
function makeAndInsertVariant(
  question_id,
  instance_question_id,
  user_id,
  authn_user_id,
  group_work,
  course_instance_id,
  variant_course,
  question_course,
  options,
  require_open,
  client_fingerprint_id,
  callback,
) {
  util.callbackify(selectQuestion)(question_id, instance_question_id, (err, question) => {
    if (ERR(err, callback)) return;
    makeVariant(question, question_course, options, (err, courseIssues, variant) => {
      if (ERR(err, callback)) return;
      const params = [
        variant.variant_seed,
        variant.params,
        variant.true_answer,
        variant.options,
        variant.broken,
        instance_question_id,
        question.id,
        course_instance_id,
        user_id,
        authn_user_id,
        group_work,
        require_open,
        variant_course.id,
        client_fingerprint_id,
      ];
      sqldb.callOneRow('variants_insert', params, (err, result) => {
        if (ERR(err, callback)) return;
        const variant = result.rows[0].variant;
        debug('variants_insert', variant);

        const studentMessage = 'Error creating question variant';
        const courseData = { variant, question, course: variant_course };
        writeCourseIssues(
          courseIssues,
          variant,
          authn_user_id,
          studentMessage,
          courseData,
          (err) => {
            if (ERR(err, callback)) return;
            return callback(null, variant);
          },
        );
      });
    });
  });
}

/**
 * Ensure that there is a variant for the given instance question.
 *
 * @param {?string} question_id - The question for the new variant. Can be null if instance_question_id is provided.
 * @param {?string} instance_question_id - The instance question for the new variant, or null for a floating variant.
 * @param {string} user_id - The user for the new variant.
 * @param {string} authn_user_id - The current authenticated user.
 * @param {boolean} group_work - If the assessment will support group work.
 * @param {?number} course_instance_id - The course instance for this variant. Can be null for instructor questions.
 * @param {Object} variant_course - The course for the variant.
 * @param {Object} question_course - The course for the question.
 * @param {Object} options - Options controlling the creation: options = {variant_seed}
 * @param {boolean} require_open - If true, only use an existing variant if it is open.
 * @param {?string} client_fingerprint_id - The client fingerprint for this variant. Can be null.
 * @param {function} callback - A callback(err, variant) function.
 */
export function ensureVariant(
  question_id,
  instance_question_id,
  user_id,
  authn_user_id,
  group_work,
  course_instance_id,
  variant_course,
  question_course,
  options,
  require_open,
  client_fingerprint_id,
  callback,
) {
  if (instance_question_id != null) {
    // see if we have a useable existing variant, otherwise
    // make a new one
    var params = [instance_question_id, require_open];
    sqldb.call('instance_questions_select_variant', params, (err, result) => {
      if (ERR(err, callback)) return;
      const variant = result.rows[0].variant;
      if (variant != null) {
        debug('instance_questions_select_variant not null', variant);
        return callback(null, variant);
      }
      makeAndInsertVariant(
        question_id,
        instance_question_id,
        user_id,
        authn_user_id,
        group_work,
        course_instance_id,
        variant_course,
        question_course,
        options,
        require_open,
        client_fingerprint_id,
        (err, variant) => {
          if (ERR(err, callback)) return;
          debug(
            'instance_questions_select_variant was null, run through _makeAndInsertVariant',
            variant,
          );
          callback(null, variant);
        },
      );
    });
  } else {
    // if we don't have instance_question_id, just make a new variant
    makeAndInsertVariant(
      question_id,
      instance_question_id,
      user_id,
      authn_user_id,
      group_work,
      course_instance_id,
      variant_course,
      question_course,
      options,
      require_open,
      client_fingerprint_id,
      (err, variant) => {
        if (ERR(err, callback)) return;
        callback(null, variant);
      },
    );
  }
}

/**
 * Get the course associated with the question
 *
 * @param {Object} question - The question for the variant.
 * @param {Object} variant_course - The course for the variant.
 */
export async function getQuestionCourse(question, variant_course) {
  if (question.course_id === variant_course.id) {
    return variant_course;
  } else {
    return selectCourseById(question.course_id);
  }
}
