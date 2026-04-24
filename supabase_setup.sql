-- ============================================================
-- ALPHA-C: Tabel sensor_data untuk Supabase
-- Jalankan SQL ini di Supabase Dashboard > SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS sensor_data (
  id BIGSERIAL PRIMARY KEY,
  ph REAL NOT NULL DEFAULT 0,
  turbidity REAL NOT NULL DEFAULT 0,
  co2 REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index untuk query berdasarkan waktu
CREATE INDEX IF NOT EXISTS idx_sensor_data_created_at ON sensor_data (created_at DESC);

-- Aktifkan Realtime agar dashboard bisa subscribe ke perubahan
ALTER PUBLICATION supabase_realtime ADD TABLE sensor_data;

-- Aktifkan Row Level Security (RLS) dan izinkan akses baca publik
ALTER TABLE sensor_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON sensor_data
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert" ON sensor_data
  FOR INSERT WITH CHECK (true);
