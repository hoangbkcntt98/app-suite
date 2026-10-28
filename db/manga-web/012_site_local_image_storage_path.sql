ALTER TABLE crawler_sites
ADD COLUMN IF NOT EXISTS local_image_storage_path TEXT;
