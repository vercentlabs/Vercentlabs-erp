BEGIN;

-- ERP 510 scope cleanup.
--
-- Recent Records and Favourites were optional workspace convenience
-- features and are no longer part of the approved mandatory ERP scope.

DROP TABLE IF EXISTS recent_records CASCADE;
DROP TABLE IF EXISTS favourites CASCADE;

COMMIT;
