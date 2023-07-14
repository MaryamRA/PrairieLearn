-- BLOCK get_course_sharing_info
SELECT
  *
FROM
  pl_courses
WHERE
  id = $course_id;

-- BLOCK select_sharing_sets
SELECT
  ss.name,
  ss.id,
  COALESCE(
    jsonb_agg(
      c.short_name
      ORDER BY
        c.short_name
    ) FILTER (
      WHERE
        c.short_name IS NOT NULL
    ),
    '[]'
  ) AS shared_with
FROM
  sharing_sets AS ss
  LEFT JOIN sharing_set_courses AS css on css.sharing_set_id = ss.id
  LEFT JOIN pl_courses AS c on c.id = css.course_id
WHERE
  ss.course_id = $course_id
GROUP BY
  ss.id
ORDER BY
  ss.name;

-- BLOCK update_sharing_token
UPDATE pl_courses
SET
  sharing_token = gen_random_uuid()
WHERE
  id = $course_id;

-- BLOCK sharing_set_create
INSERT INTO
  sharing_sets (course_id, name)
VALUES
  ($course_id, $sharing_set_name);

-- BLOCK course_sharing_set_add
INSERT INTO
  sharing_set_courses (course_id, sharing_set_id)
SELECT
  id,
  $sharing_set_id
FROM
  pl_courses
WHERE
  sharing_token = $course_sharing_token;

-- BLOCK choose_sharing_name
UPDATE pl_courses
SET
  sharing_name = $sharing_name
WHERE
  id = $course_id;
