package main

import (
	"context"
	"testing"
	"time"
)

func TestPracticeSummarySingleConnection(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()

	if _, err := db.Exec(`WITH RECURSIVE days(n) AS (
		VALUES(0) UNION ALL SELECT n+1 FROM days WHERE n<404
	) INSERT INTO learning_activity(user_id, activity_date)
	SELECT 'user_oche', date('2024-02-29', '-' || n || ' days') FROM days`); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		date      string
		completed bool
		length    int
	}{
		{"2024-02-29", true, 405},
		{"2024-03-01", false, 405},
		{"2024-03-02", false, 0},
		{"2020-01-01", false, 0},
	} {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		done, length, err := practiceSummary(ctx, "user_oche", test.date)
		cancel()
		if err != nil || done != test.completed || length != test.length {
			t.Fatalf("%s: got (%v, %d, %v), want (%v, %d, nil)", test.date, done, length, err, test.completed, test.length)
		}
	}
}
