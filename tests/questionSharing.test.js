// @ts-check
const ERR = require('async-stacktrace');
const { assert } = require('chai');
const { step } = require('mocha-steps');
const path = require('path');
const config = require('../lib/config');
const fetch = require('node-fetch').default;
const helperClient = require('./helperClient');
const helperServer = require('./helperServer');
const sqlLoader = require('../prairielib/lib/sql-loader');
const sqldb = require('../prairielib/lib/sql-db');
const sql = sqlLoader.loadSqlEquiv(__filename);

const syncFromDisk = require('../sync/syncFromDisk');
const logger = require('./dummyLogger');

const siteUrl = 'http://localhost:' + config.serverPort;
const baseUrl = siteUrl + '/pl';

config.questionSharingEnabled = true;

const UUID_REGEXP = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

const testCourseId = 1;
const testCourseSharingName = 'test-course';
const exampleCourseId = 2;
const exampleCourseSharingName = 'example-course';
const sharingSetName = 'share-set-example';

function sharingPageUrl(courseId) {
  return `${baseUrl}/course/${courseId}/course_admin/sharing`;
}

async function setSharingName(courseId, name) {
  const sharingUrl = sharingPageUrl(courseId);
  const response = await helperClient.fetchCheerio(sharingUrl);

  const token = response.$('#test_csrf_token').text();
  await fetch(sharingUrl, {
    method: 'POST',
    headers: { 'Content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      __action: 'choose_sharing_name',
      __csrf_token: token,
      course_sharing_name: name,
    }).toString(),
  });
}

async function accessSharedQuestionAssessment() {
  const assessmentsUrl = `${baseUrl}/course_instance/${exampleCourseId}/instructor/instance_admin/assessments`;
  const assessmentsPage = await helperClient.fetchCheerio(assessmentsUrl);
  const sharedQuestionAssessmentUrl =
    siteUrl +
    assessmentsPage
      .$(`a:contains("Example of Importing Questions From Another Course")`)
      .attr('href');
  let res = await helperClient.fetchCheerio(sharedQuestionAssessmentUrl);
  assert.equal(res.ok, true);
  return res;
}

describe('Question Sharing', function () {
  this.timeout(80000);

  // Must sync two courses to test sharing from one to the other, and we must
  // force one sync to complete before the other to avoid database errors

  describe('Create a sharing set and add a question to it', () => {
    let exampleCourseSharingId;


    step(
      'set up testing server',
      helperServer.before([
        path.join(__dirname, '..', 'testCourse'),
        path.join(__dirname, '..', 'exampleCourse'),
      ])
    );

    // step(
    //   'set up testing server',
    //   async () => {
    //     let syncSucceeded = true;
    //     try {
    //       helperServer.before([
    //         path.join(__dirname, '..', 'testCourse'),
    //         path.join(__dirname, '..', 'exampleCourse'),
    //       ])();
    //     } catch (err) {
    //       syncSucceeded = false;
    //       console.log('caught the error!')
    //     }
    //     // console.log(syncSucceeded);
    //     // assert(!syncSucceeded); // Sync should fail because question sharing not yet enabled for course
    // });
    
    step('ensure course has question sharing enabled', async () => {
      await sqldb.queryAsync(sql.enable_question_sharing, {});
    });

    // step(
    //   'Now that sharing is enabled for the example course, sync should succeed',
    //   (callback) => {
    //     const courseDir = path.join(__dirname, '..', 'exampleCourse');
    //     syncFromDisk.syncOrCreateDiskToSql(courseDir, logger, function (err, result) {
    //       if (ERR(err, callback)) return;
    //       if (result.hadJsonErrorsOrWarnings) {
    //         console.log(logger.getOutput());
    //         return callback(
    //           new Error(
    //             `Errors or warnings found during sync of ${courseDir} (output printed to console)`
    //           )
    //         );
    //       }
    //       callback(null);
    //     });
    //   }
    // );

    step(
      'Fail to access shared question, because permission has not yet been granted',
      async () => {
        let res = await accessSharedQuestionAssessment();
        // TODO: currently the QID won't show up on the page at all. If we add a dummy question to the DB,
        // then the name of it will show up, but it should fail to load when you access the link
        assert(!res.text().includes('addNumbers'));
      }
    );

    step('Fail if trying to set an invalid sharing name', async () => {
      // TODO throw an exception in SQL, catch it, return an error
    });

    step('Set test course sharing name', async () => {
      await setSharingName(testCourseId, testCourseSharingName);
      let sharingPage = await (await fetch(sharingPageUrl(testCourseId))).text();
      assert(sharingPage.includes(testCourseSharingName));
    });

    step('Fail if trying to set sharing name again.', async () => {
      // TODO throw an exception in SQL, catch it, return an error
    });

    step('Set example course sharing name', async () => {
      await setSharingName(exampleCourseId, exampleCourseSharingName);
      let sharingPage = await (await fetch(sharingPageUrl(exampleCourseId))).text();
      assert(sharingPage.includes(exampleCourseSharingName));
    });

    step('Generate sharing ID for example course', async () => {
      const sharingUrl = sharingPageUrl(exampleCourseId);
      let response = await helperClient.fetchCheerio(sharingUrl);
      const token = response.$('#test_csrf_token').text();
      await fetch(sharingUrl, {
        method: 'POST',
        headers: { 'Content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          __action: 'sharing_id_regenerate',
          __csrf_token: token,
        }).toString(),
      });

      response = await helperClient.fetchCheerio(sharingUrl);
      exampleCourseSharingId = UUID_REGEXP.exec(response.text())[0];
      assert(exampleCourseSharingId != null);
    });

    step('Create a sharing set', async () => {
      const sharingUrl = sharingPageUrl(testCourseId);
      let response = await helperClient.fetchCheerio(sharingUrl);
      const token = response.$('#test_csrf_token').text();
      await fetch(sharingUrl, {
        method: 'POST',
        headers: { 'Content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          __action: 'sharing_set_create',
          __csrf_token: token,
          sharing_set_name: sharingSetName,
        }).toString(),
      });

      let sharingPage = await (await fetch(sharingPageUrl(exampleCourseId))).text();
      assert(sharingPage.includes(exampleCourseSharingName));
    });

    // step('Attempt to create another sharing set with the same name', async () => {
    //   // TODO ensure that the sharing set name you created only appears once on the page
    // });

    // step('Attempt to create a sharing set with an invalid name', async () => {

    // });

    step('Share sharing set with example course', async () => {
      const sharingUrl = sharingPageUrl(testCourseId);
      let response = await helperClient.fetchCheerio(sharingUrl);
      const token = response.$('#test_csrf_token').text();
      await fetch(sharingUrl, {
        method: 'POST',
        headers: { 'Content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          __action: 'course_sharing_set_add',
          __csrf_token: token,
          sharing_set_id: '1',
          course_sharing_id: exampleCourseSharingId,
        }).toString(),
      }); // TODO: should this endpoint return an error if the sharing set passed in is not valid or doesn't belong to the course?

      let sharingPage = await (await fetch(sharingPageUrl(testCourseId))).text();
      assert(sharingPage.includes('XC 101'));
    });

    // step('Attempt to share sharing set with invalid course ID', async () => {

    // });

    // step('Attempt to create another sharing set with the same name', async () => {

    // });

    step('Add question "addNumbers" to sharing set', async () => {
      // TODO: should this block of code be factored out to helperClient as a
      // helper function for getting to the page of a question with a given qid?
      // or does this code already exist somewhere and I am duplicating effort here?
      const questionsUrl = `${baseUrl}/course/${testCourseId}/course_admin/questions`;
      const questionsPage = await helperClient.fetchCheerio(questionsUrl);
      const questionData = questionsPage.$('#questionsTable').attr('data-data');
      const questions = JSON.parse(questionData);
      const addNumbersInfo = questions.find((questionInfo) => questionInfo.qid === 'addNumbers');

      const questionSettingsUrl = `${baseUrl}/course_instance/${testCourseId}/instructor/question/${addNumbersInfo.id}/settings`;
      let response = await helperClient.fetchCheerio(questionSettingsUrl);
      assert.equal(response.ok, true);

      const token = response.$('#test_csrf_token').text();
      response = await fetch(questionSettingsUrl, {
        method: 'POST',
        headers: { 'Content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          __action: 'sharing_set_add',
          __csrf_token: token,
          sharing_set_id: '1',
        }).toString(),
      }); // TODO: should this endpoint return an error if the sharing set passed in is not valid or doesn't belong to the course?

      let settingsPage = await (await fetch(questionSettingsUrl)).text();
      assert(settingsPage.includes('share-set-example'));
    });

    step(
      'Re-sync example course so that the shared question gets added in properly',
      (callback) => {
        const courseDir = path.join(__dirname, '..', 'exampleCourse');
        syncFromDisk.syncOrCreateDiskToSql(courseDir, logger, function (err, result) {
          if (ERR(err, callback)) return;
          if (result.hadJsonErrorsOrWarnings) {
            console.log(logger.getOutput());
            return callback(
              new Error(
                `Errors or warnings found during sync of ${courseDir} (output printed to console)`
              )
            );
          }
          callback(null);
        });
      }
    );

    step('Successfully access shared question', async () => {
      let res = await accessSharedQuestionAssessment();
      const sharedQuestionUrl = siteUrl + res.$(`a:contains("Add two numbers")`).attr('href');

      res = await helperClient.fetchCheerio(sharedQuestionUrl);
      assert.equal(res.ok, true);
    });

    step('shut down testing server', helperServer.after);
  });
});
