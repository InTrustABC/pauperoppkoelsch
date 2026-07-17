# Agent Instructions

- This is an Astro.js developer workspace for a Magic: The Gathering site.
- Use the Melee.gg API to fetch tournament and player data, then store it in the database.
- Use Chart.js to display the stored data in the site UI.
- This repository has a root `.env` file with server-side credentials.
- Use `DATABASE_URL` from that file when a task needs a PostgreSQL connection.
- You may use the database connection to read and write data when the user asks for it.
- Treat all `.env` values as secrets: do not print them, commit them, or copy them into logs.
- Related scripts already read `process.env.DATABASE_URL`, `process.env.MELEE_API_CLIENT_ID`, and `process.env.MELEE_API_CLIENT_SECRET`.
