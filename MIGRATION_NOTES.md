# Mystics Dashboard Migration Notes

This project was scaffolded from `nba_dashboard` as a separate codebase that can still point to the same Supabase project.

Initial split already done:

- project folder created at `mystics_dashboard/`
- package/app identity renamed to `mystics-dashboard`
- Capacitor app id and app name renamed to Mystics equivalents
- app-specific env keys added:
  - `VITE_APP_KEY=wnba_mystics`
  - `VITE_APP_NAME=Mystics Dashboard`
  - `VITE_APP_SHORT_NAME=Mystics`
  - `VITE_PRIMARY_TEAM_SCOPE=Mystics`
- `src/appConfig.js` added for app-level identity values
- auth screen branding switched to env-driven Mystics values

High-priority next migration work:

1. Replace Wizards/Go-Go specific logic with Mystics-specific logic.
   - `src/pregamePlayers.js`
   - `src/pages/Game.jsx`
   - `src/pages/PreGame.jsx`
   - `src/pages/Rotations.jsx`
   - `src/pages/UserContent.jsx`

2. Add WNBA-aware league detection.
   - `src/api.js`
   - `src/components/BoxScoreTable.jsx`
   - anywhere else that assumes only `nba` and `gleague`

3. Add WNBA team data sources.
   - replace or supplement `src/data/nbaTeams.js`
   - add WNBA roster fetch equivalent to the current NBA/G League roster functions

4. Make Supabase records app-aware if this project will share the same Supabase backend as the NBA app.
   - invites / memberships
   - notes
   - drawings
   - tool records
   - shared roster state

Known limitation of the current scaffold:

- many UI and workflow files still contain Washington Wizards / Capital City assumptions because this step created the separate project shell, not the full WNBA conversion
