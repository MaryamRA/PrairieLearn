-- BLOCK setup_caa_scheduler_tests
WITH
  setup_users AS (
    INSERT INTO
      users (user_id, uid)
    VALUES
      (1000, 'student@school.edu')
  ),
  setup_pt_courses AS (
    INSERT INTO
      pt_courses (id, name)
    VALUES
      (1, 'Course 1')
  ),
  setup_pt_sessions AS (
    INSERT INTO
      pt_sessions (id)
    VALUES
      (1)
  ),
  setup_pt_enrollments AS (
    INSERT INTO
      pt_enrollments (id, user_id)
    VALUES
      (1, 1000)
  ),
  setup_pt_exams AS (
    INSERT INTO
      pt_exams (id, uuid, name, course_id)
    VALUES
      (
        1,
        '890884f9-aa9d-4fc0-b910-5229794906fb',
        'Exam 1',
        1
      )
  ),
  setup_pl_course AS (
    INSERT INTO
      pl_courses (id)
    VALUES
      (1)
  ),
  setup_ci AS (
    INSERT INTO
      course_instances (id, uuid, course_id)
    VALUES
      (1, 'b3d010d2-dbef-4b5b-ba4d-92f9aea25c8d', 1)
  ),
  setup_assessment_sets AS (
    INSERT INTO
      assessment_sets (id, course_id)
    VALUES
      (1, 1)
  ),
  setup_assessments AS (
    INSERT INTO
      assessments (
        id,
        uuid,
        tid,
        title,
        course_instance_id,
        assessment_set_id
      )
    VALUES
      (
        10,
        '423e8913-0608-4c85-9b2e-bca9c81f52d3',
        'someExam',
        'Some Exam',
        1,
        1
      ),
      (
        11,
        'a0b4cd67-931d-4173-b722-23d3f3a359a5',
        'someExam',
        'Some Exam',
        1,
        1
      ),
      (
        12,
        '91fac0da-e943-4775-83ff-aef9487a1c9f',
        'someExam',
        'Some Exam',
        1,
        1
      ),
      (
        50,
        'd92f7657-30b4-4bcd-9ccf-a2b4a5022c64',
        'accessExam',
        'Access Exam',
        1,
        1
      ),
      (
        51,
        'f92f7657-30b4-4bcd-9ccf-a2b4a5022c64',
        'accessExam',
        'Access Exam',
        1,
        1
      ),
      (
        52,
        'a92f7657-30b4-4bcd-9ccf-a2b4a5022c64',
        'accessExam',
        'Access Exam',
        1,
        1
      )
  ),
  setup_assessment_access_rule AS (
    INSERT INTO
      assessment_access_rules (
        assessment_id,
        mode,
        start_date,
        end_date,
        credit,
        exam_uuid,
        uids,
        role
      )
    VALUES
      (
        10,
        'Exam',
        '2010-01-01 00:00:01-00',
        '2010-12-31 23:59:59-00',
        100,
        null,
        null,
        null
      ),
      (
        11,
        'Exam',
        '2010-01-01 00:00:01-00',
        '2010-12-31 23:59:59-00',
        100,
        '890884f9-aa9d-4fc0-b910-5229794906fb',
        null,
        null
      ),
      (
        12,
        'Exam',
        '2010-01-01 00:00:01-00',
        '2010-12-31 23:59:59-00',
        100,
        '40dec9a8-a5c6-476d-afd6-3ab52e3d0ed3',
        null,
        null
      ),
      (
        50,
        'Public',
        '2010-01-01 00:00:01-00',
        '2010-12-31 23:59:59-00',
        100,
        null,
        '{valid@school.edu}',
        null
      ),
      (
        51,
        'Public',
        '2010-01-01 00:00:01-00',
        '2010-12-31 23:59:59-00',
        100,
        null,
        '{valid@school.edu}',
        'Instructor'
      ),
      (
        52,
        'Public',
        '2010-01-01 00:00:01-00',
        '2010-12-31 23:59:59-00',
        100,
        'bf6df059-6760-4cf0-ac32-35a43e28a3e7',
        null,
        null
      )
  )
SELECT
  true;

-- BLOCK insert_pt_reservation
WITH
  remove_reservations AS (
    DELETE FROM pt_reservations
  ),
  insert_new_reservation AS (
    INSERT INTO
      pt_reservations (
        exam_id,
        enrollment_id,
        session_id,
        access_start,
        access_end
      )
    VALUES
      (
        $exam_id,
        1,
        1,
        '2010-07-01 00:00:00-00',
        '2010-07-31 23:59:59-00'
      )
  )
SELECT
  true;
