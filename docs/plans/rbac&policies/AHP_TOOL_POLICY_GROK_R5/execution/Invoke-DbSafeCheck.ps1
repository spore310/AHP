param(
  [Parameter(Mandatory = $true)][string]$LogPath,
  [Parameter(Mandatory = $true)][string[]]$CommandArgs
)

# Invoke in a child PowerShell process. Never restore or print inherited values.
$blockedNames = @(
  'AGENT_HOSTING_PROTOCOL_DATABASE_URL', 'AGENT_HOSTING_PROTOCOL_AUTH_TOKENS',
  'AGENT_HOSTING_PROTOCOL_PERSISTENCE_PROVIDER', 'AHP_TEST_DATABASE_URL',
  'DATABASE_URL', 'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER',
  'PGPASSWORD', 'PGDATA', 'PGSSLMODE', 'PGPASSFILE', 'PGSERVICE',
  'PGSERVICEFILE', 'PGOPTIONS', 'PGAPPNAME', 'SUPABASE_URL', 'SUPABASE_DB_URL',
  'POSTGRES_URL', 'POSTGRES_PRISMA_URL'
)
foreach ($name in $blockedNames) {
  [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
& pnpm @CommandArgs 2>&1 | Tee-Object -FilePath $LogPath
$checkExit = $LASTEXITCODE
"CHECK_EXIT:$checkExit" | Tee-Object -FilePath $LogPath -Append
exit $checkExit
