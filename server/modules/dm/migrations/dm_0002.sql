-- R17-D · 私信编辑。dm_message 只有 recalled_at，没有编辑时间，所以补一列（编辑本身复用 text 列，不另建表）。
ALTER TABLE dm_message ADD COLUMN edited_at TEXT;
