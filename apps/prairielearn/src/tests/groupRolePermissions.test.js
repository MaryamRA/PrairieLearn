const assert = require('chai').assert;
const cheerio = require('cheerio');
const fetch = require('node-fetch').default;
const { step } = require('mocha-steps');
const util = require('util');

const { config } = require('../lib/config');
const sqldb = require('@prairielearn/postgres');
const sql = sqldb.loadSqlEquiv(__filename);

const helperServer = require('./helperServer');
const { URLSearchParams } = require('url');
const { TEST_COURSE_PATH } = require('../lib/paths');

let elemList;
const locals = {};
locals.helperClient = require('./helperClient');
locals.siteUrl = 'http://localhost:' + config.serverPort;
locals.baseUrl = locals.siteUrl + '/pl';
locals.courseInstanceUrl = locals.baseUrl + '/course_instance/1';
locals.assessmentsUrl = locals.courseInstanceUrl + '/assessments';
locals.courseDir = TEST_COURSE_PATH;

const storedConfig = {};

let questionOneUrl, questionTwoUrl, questionThreeUrl;

/**
 * Switches `config` to new user, loads assessment page, and changes local CSRF token
 * @param {Object} studentUser
 * @param {string} assessmentUrl
 * @param {String} authUin
 * @param {Number} numCsrfTokens
 */
const switchUserAndLoadAssessment = async (studentUser, assessmentUrl, authUin, numCsrfTokens) => {
  // Load config
  config.authUid = studentUser.uid;
  config.authName = studentUser.name;
  config.authUin = authUin;
  config.userId = studentUser.user_id;

  // Load assessment
  const res = await fetch(assessmentUrl);
  assert.isOk(res.ok);
  const page = await res.text();
  locals.$ = cheerio.load(page);

  // Check for CSRF tokens
  elemList = locals.$('form input[name="__csrf_token"]');
  assert.lengthOf(elemList, numCsrfTokens);
  assert.nestedProperty(elemList[0], 'attribs.value');
  locals.__csrf_token = elemList[0].attribs.value;
  assert.isString(locals.__csrf_token);
};

/**
 * Joins group as current user with CSRF token and loads page with cheerio.
 * @param {String} assessmentUrl
 * @param {String} joinCode
 */
const joinGroup = async (assessmentUrl, joinCode) => {
  const form = {
    __action: 'join_group',
    __csrf_token: locals.__csrf_token,
    join_code: joinCode,
  };
  const res = await fetch(assessmentUrl, {
    method: 'POST',
    body: new URLSearchParams(form),
  });
  assert.isOk(res.ok);
  locals.$ = cheerio.load(await res.text());
};

/**
 * Sends and verifies a group roles update request using current user.
 * Updates element list to check that group role select table is changed correctly.
 * @param {Array} roleUpdates
 * @param {Array} groupRoles
 * @param {Array} studentUsers
 * @param {String} assessmentUrl
 */
const updateGroupRoles = async (roleUpdates, groupRoles, studentUsers, assessmentUrl) => {
  // Uncheck all of the inputs
  const roleIds = groupRoles.map((role) => role.id);
  const userIds = studentUsers.map((user) => user.user_id);
  for (const roleId of roleIds) {
    for (const userId of userIds) {
      const elementId = `#user_role_${roleId}-${userId}`;
      locals.$('#role-select-form').find(elementId).attr('checked', null);
    }
  }

  // Ensure all checkboxes are unchecked
  elemList = locals.$('#role-select-form').find('tr').find('input:checked');
  assert.lengthOf(elemList, 0);

  // Mark the checkboxes as checked
  roleUpdates.forEach(({ roleId, groupUserId }) => {
    locals.$(`#user_role_${roleId}-${groupUserId}`).attr('checked', '');
  });
  elemList = locals.$('#role-select-form').find('tr').find('input:checked');
  assert.lengthOf(elemList, roleUpdates.length);

  // Grab IDs of checkboxes to construct update request
  const checkedElementIds = {};
  for (let i = 0; i < elemList.length; i++) {
    checkedElementIds[elemList[i.toString()].attribs.id] = 'on';
  }
  const form = {
    __action: 'update_group_roles',
    __csrf_token: locals.__csrf_token,
    ...checkedElementIds,
  };
  const res = await fetch(assessmentUrl, {
    method: 'POST',
    body: new URLSearchParams(form),
  });
  assert.isOk(res.ok);
};

describe('Test group role functionality within assessments', function () {
  this.timeout(20000);

  before('set authenticated user', function () {
    storedConfig.authUid = config.authUid;
    storedConfig.authName = config.authName;
    storedConfig.authUin = config.authUin;
  });

  before('set up testing server', async function () {
    await util.promisify(helperServer.before(locals.courseDir).bind(this))();

    // Find the ID of an assessment that has group roles
    const assessmentResults = await sqldb.queryOneRowAsync(sql.select_assessment, {
      tid: 'hw5-templateGroupWork',
    });
    locals.assessmentId = assessmentResults.rows[0].id;
    locals.assessmentUrl = locals.courseInstanceUrl + '/assessment/' + locals.assessmentId;
  });

  after('shut down testing server', helperServer.after);

  after('unset authenticated user', function () {
    Object.assign(config, storedConfig);
  });

  describe('set up group assessment', async function () {
    step('can insert/get 3 users into/from the DB', async function () {
      const result = await sqldb.queryAsync(sql.generate_and_enroll_3_users, []);
      assert.lengthOf(result.rows, 3);
      locals.studentUsers = result.rows;
    });

    step('contains the 4 group roles for the assessment', async function () {
      const params = {
        assessment_id: locals.assessmentId,
      };
      const result = await sqldb.queryAsync(sql.select_assessment_group_roles, params);
      assert.lengthOf(result.rows, 4);
      locals.groupRoles = result.rows;

      locals.manager = result.rows.find((row) => row.role_name === 'Manager');
      locals.recorder = result.rows.find((row) => row.role_name === 'Recorder');
      locals.reflector = result.rows.find((row) => row.role_name === 'Reflector');
      locals.contributor = result.rows.find((row) => row.role_name === 'Contributor');
    });

    step('can create a group as first user', async function () {
      await switchUserAndLoadAssessment(
        locals.studentUsers[0],
        locals.assessmentUrl,
        '00000001',
        2,
      );

      locals.group_name = 'groupBB';
      const form = {
        __action: 'create_group',
        __csrf_token: locals.__csrf_token,
        groupName: locals.group_name,
      };
      const res = await fetch(locals.assessmentUrl, {
        method: 'POST',
        body: new URLSearchParams(form),
      });
      assert.isOk(res.ok);
      locals.$ = cheerio.load(await res.text());
      locals.joinCode = locals.$('#join-code').text();
    });

    step('can join group as second and third users', async function () {
      await switchUserAndLoadAssessment(
        locals.studentUsers[1],
        locals.assessmentUrl,
        '00000002',
        2,
      );
      await joinGroup(locals.assessmentUrl, locals.joinCode);
      await switchUserAndLoadAssessment(
        locals.studentUsers[2],
        locals.assessmentUrl,
        '00000003',
        2,
      );
      await joinGroup(locals.assessmentUrl, locals.joinCode);
    });

    step('can assign group roles as first user', async function () {
      await switchUserAndLoadAssessment(
        locals.studentUsers[0],
        locals.assessmentUrl,
        '00000001',
        2,
      );
      locals.roleUpdates = [
        { roleId: locals.manager.id, groupUserId: locals.studentUsers[0].user_id },
        { roleId: locals.recorder.id, groupUserId: locals.studentUsers[1].user_id },
        { roleId: locals.reflector.id, groupUserId: locals.studentUsers[2].user_id },
      ];
      await updateGroupRoles(
        locals.roleUpdates,
        locals.groupRoles,
        locals.studentUsers,
        locals.assessmentUrl,
      );
    });

    step('can start asssesment', async function () {
      var form = {
        __action: 'new_instance',
        __csrf_token: locals.__csrf_token,
      };
      const res = await fetch(locals.assessmentUrl, {
        method: 'POST',
        body: new URLSearchParams(form),
      });
      assert.isOk(res.ok);
      locals.$ = cheerio.load(await res.text());
    });

    step('should have 1 assessment instance in db', async function () {
      const result = await sqldb.queryAsync(sql.select_all_assessment_instance, []);
      assert.lengthOf(result.rows, 1);
      locals.assessment_instance_id = result.rows[0].id;
      locals.assessmentInstanceURL =
        locals.courseInstanceUrl + '/assessment_instance/' + locals.assessment_instance_id;
      assert.equal(result.rows[0].group_id, 1);
    });

    step('should have three questions', async function () {
      const params = {
        assessment_instance_id: locals.assessment_instance_id,
        question_id: 'demo/demoNewton-page1',
      };
      let result = await sqldb.queryAsync(sql.select_instance_questions, params);
      assert.lengthOf(result.rows, 1);
      questionOneUrl = locals.courseInstanceUrl + '/instance_question/' + result.rows[0].id;

      params.question_id = 'demo/demoNewton-page2';
      result = await sqldb.queryAsync(sql.select_instance_questions, params);
      assert.lengthOf(result.rows, 1);
      questionTwoUrl = locals.courseInstanceUrl + '/instance_question/' + result.rows[0].id;

      params.question_id = 'addNumbers';
      result = await sqldb.queryAsync(sql.select_instance_questions, params);
      assert.lengthOf(result.rows, 1);
      questionThreeUrl = locals.courseInstanceUrl + '/instance_question/' + result.rows[0].id;
    });
  });

  describe('test visibility of role select table', async function () {
    step('can view role select table with correct permission', async function () {
      elemList = locals.$('#role-select-form');
      assert.lengthOf(elemList, 1);
    });

    step('cannot view role select table without correct permission', async function () {
      await switchUserAndLoadAssessment(
        locals.studentUsers[1],
        locals.assessmentInstanceURL,
        '00000002',
        3,
      );
      elemList = locals.$('#role-select-form');
      assert.lengthOf(elemList, 0);
    });
  });

  describe('test functionality when role configuration is invalid', async function () {
    step('error message should be shown when role config is invalid', async function () {
      await switchUserAndLoadAssessment(
        locals.studentUsers[0],
        locals.assessmentInstanceURL,
        '00000001',
        4,
      );
      locals.roleUpdates = [
        { roleId: locals.manager.id, groupUserId: locals.studentUsers[0].user_id },
        { roleId: locals.recorder.id, groupUserId: locals.studentUsers[1].user_id },
        { roleId: locals.reflector.id, groupUserId: locals.studentUsers[1].user_id },
        { roleId: locals.reflector.id, groupUserId: locals.studentUsers[2].user_id },
      ];
      await updateGroupRoles(
        locals.roleUpdates,
        locals.groupRoles,
        locals.studentUsers,
        locals.assessmentInstanceURL,
      );

      const res = await fetch(locals.assessmentInstanceURL);
      assert.isOk(res.ok);
      locals.$ = cheerio.load(await res.text());

      elemList = locals.$('.alert:contains(Invalid role configuration)');
      assert.lengthOf(elemList, 1);
    });

    step('submit button should be disabled when role config is invalid', async function () {
      const res = await fetch(questionOneUrl);
      assert.isOk(res.ok);
      locals.$ = cheerio.load(await res.text());

      const button = locals.$('.question-grade');
      assert.isTrue(button.is(':disabled'));
      const popover = locals.$('.btn[aria-label="Locked"]');
      assert.lengthOf(popover, 1);
      const popoverContent = popover.data('content');
      assert.strictEqual(
        popoverContent,
        "Your group's role configuration is invalid. Question submissions are disabled until your role configuration is correct.",
      );
    });

    step('no error message should be shown when role config is valid', async function () {
      let res = await fetch(locals.assessmentInstanceURL);
      assert.isOk(res.ok);
      locals.$ = cheerio.load(await res.text());
      locals.roleUpdates = [
        { roleId: locals.manager.id, groupUserId: locals.studentUsers[0].user_id },
        { roleId: locals.recorder.id, groupUserId: locals.studentUsers[1].user_id },
        { roleId: locals.reflector.id, groupUserId: locals.studentUsers[2].user_id },
      ];
      await updateGroupRoles(
        locals.roleUpdates,
        locals.groupRoles,
        locals.studentUsers,
        locals.assessmentInstanceURL,
      );

      res = await fetch(locals.assessmentInstanceURL);
      assert.isOk(res.ok);
      locals.$ = cheerio.load(await res.text());

      elemList = locals.$('.alert:contains(This is an invalid role configuration)');
      assert.lengthOf(elemList, 0);
    });
  });

  describe('test question viewing restriction', async function () {
    step('the second and third questions should not be viewable', async function () {
      const lockedRows = locals.$('tr.pl-sequence-locked');
      assert.lengthOf(lockedRows, 2);

      lockedRows.each((_, element) => {
        const rowLabelText = locals.$(element).find('span.text-muted, a').text();
        assert.match(rowLabelText, /HW5\.[23]\./);
        const popoverText = locals.$(element).find('[data-toggle="popover"]').attr('data-content');
        assert.strictEqual(
          popoverText,
          "Your current group role doesn't have permission to view this question.",
        );
      });
    });

    step('the first question should be fully viewable with no errors', async function () {
      const res = await fetch(questionOneUrl);
      assert.isOk(res.ok);
      locals.$ = cheerio.load(await res.text());
    });

    step('the second question should not be viewable', async function () {
      const res = await fetch(questionTwoUrl);
      assert.isNotOk(res.ok);
      locals.$ = cheerio.load(await res.text());
    });

    step('the "next question" button skips unviewable questions', async function () {
      await switchUserAndLoadAssessment(
        locals.studentUsers[2],
        locals.assessmentUrl,
        '00000003',
        3,
      );
      const res = await fetch(questionOneUrl);
      assert.isOk(res.ok);
      locals.$ = cheerio.load(await res.text());

      const nextQuestionLink = locals.$('#question-nav-next').attr('href');
      assert.strictEqual(locals.siteUrl + nextQuestionLink, questionThreeUrl + '/');
    });

    step('the "previous question" button skips unviewable questions', async function () {
      const res = await fetch(questionThreeUrl);
      assert.isOk(res.ok);
      locals.$ = cheerio.load(await res.text());

      const prevQuestionLink = locals.$('#question-nav-prev').attr('href');
      assert.strictEqual(locals.siteUrl + prevQuestionLink, questionOneUrl + '/');
    });
  });

  describe('test question submitting restriction', async function () {
    step('save and grade button is not disabled with correct permission', async function () {
      await switchUserAndLoadAssessment(
        locals.studentUsers[1],
        locals.assessmentUrl,
        '00000002',
        3,
      );
      const res = await fetch(questionOneUrl);
      assert.isOk(res.ok);
      locals.$ = cheerio.load(await res.text());

      const button = locals.$('.question-grade');
      assert.isFalse(button.is(':disabled'));
    });

    step('save and grade button is disabled without correct permission', async function () {
      await switchUserAndLoadAssessment(
        locals.studentUsers[0],
        locals.assessmentInstanceURL,
        '00000001',
        4,
      );
      const res = await fetch(questionOneUrl);
      assert.isOk(res.ok);
      locals.$ = cheerio.load(await res.text());

      const button = locals.$('.question-grade');
      assert.isTrue(button.is(':disabled'));
      const popover = locals.$('.btn[aria-label="Locked"]');
      assert.lengthOf(popover, 1);
      const popoverContent = popover.data('content');
      assert.strictEqual(
        popoverContent,
        'You are not assigned a role that can submit this question.',
      );
    });

    // TODO: Write tests that confirm actually hitting "Submit" is still fine, or doesn't work
    // step('submitting by POST request with invalid permission produces an error', async function () {
    //     const form = {
    //         __action: 'grade',
    //         __csrf_token: locals.__csrf_token,
    //     };
    //     const res = await fetch(questionOneUrl, {
    //         method: 'POST',
    //         body: new URLSearchParams(form),
    //     });
    //     assert.isNotOk(res.ok);
    // });

    // step('submitting with valid permissions does not yield any errors', async function () {
    //     await switchUserAndLoadAssessment(locals.studentUsers[1], questionOneUrl, '00000002', 5);
    //     const form = {
    //         __action: 'grade',
    //         __csrf_token: locals.__csrf_token,
    //     };
    //     const res = await fetch(questionOneUrl, {
    //         method: 'POST',
    //         body: new URLSearchParams(form),
    //     });
    //     assert.isOk(res.ok);
    // });
  });
});
