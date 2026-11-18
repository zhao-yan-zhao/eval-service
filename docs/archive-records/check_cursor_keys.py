# -*- coding: utf-8 -*-
"""只列出 Cursor 本地凭证的 key 名和值长度，不打印任何敏感值"""
import sqlite3, os

db = os.path.join(os.environ["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb")
uri = "file:" + db.replace("\\", "/") + "?mode=ro"
conn = sqlite3.connect(uri, uri=True)
cur = conn.cursor()
rows = cur.execute(
    "SELECT key, length(value) FROM ItemTable "
    "WHERE key LIKE '%Auth%' OR key LIKE '%apiKey%' OR key LIKE '%ApiKey%' "
    "OR key LIKE '%APIKey%' OR key LIKE '%token%' OR key LIKE '%Token%'"
).fetchall()
for k, l in rows:
    print(k, "(value length:", l, ")")
conn.close()
