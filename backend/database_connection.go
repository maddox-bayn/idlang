package main

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/tursodatabase/libsql-client-go/libsql"
)

// Remote credentials belong only to the Go service. Never fall back to a local
// database when Turso is configured incorrectly: that would split user accounts.
func openConfiguredDB() (*sql.DB, error) {
	remoteURL := strings.TrimSpace(os.Getenv("TURSO_DATABASE_URL"))
	token := strings.TrimSpace(os.Getenv("TURSO_AUTH_TOKEN"))
	if remoteURL == "" && token == "" {
		return initDB(os.Getenv("DATABASE_PATH"))
	}
	if err := validateTursoConfig(remoteURL, token); err != nil {
		return nil, err
	}
	connector, err := libsql.NewConnector(remoteURL, libsql.WithAuthToken(token))
	if err != nil {
		return nil, errors.New("invalid Turso connection configuration")
	}
	database := sql.OpenDB(connector)
	database.SetMaxOpenConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var connected int
	if err := database.QueryRowContext(ctx, "SELECT 1").Scan(&connected); err != nil {
		database.Close()
		return nil, errors.New("cannot connect to Turso; check database URL, token, and network access")
	}
	if err := initializeSchema(database); err != nil {
		database.Close()
		// Driver errors may contain remote responses. Keep credentials out of logs.
		return nil, errors.New("Turso schema initialization failed; check write permissions and database compatibility")
	}
	return database, nil
}

func validateTursoConfig(rawURL, token string) error {
	if rawURL == "" || token == "" {
		return errors.New("set both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN")
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" || (u.Scheme != "libsql" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return errors.New("TURSO_DATABASE_URL must be a libsql:// or https:// host without credentials, query, or path")
	}
	return nil
}
