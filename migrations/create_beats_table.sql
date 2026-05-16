-- Create beats table
CREATE TABLE IF NOT EXISTS beats (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    file_size BIGINT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    loop_id INTEGER REFERENCES loops(id) ON DELETE SET NULL,
    description TEXT,
    tags JSONB DEFAULT '[]'::jsonb,
    bpm INTEGER,
    key VARCHAR(10),
    genre VARCHAR(100),
    is_collaboration BOOLEAN DEFAULT false,
    collaboration_credit TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_beats_user_id ON beats(user_id);
CREATE INDEX IF NOT EXISTS idx_beats_loop_id ON beats(loop_id);
CREATE INDEX IF NOT EXISTS idx_beats_created_at ON beats(created_at DESC);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_beats_updated_at BEFORE UPDATE ON beats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
