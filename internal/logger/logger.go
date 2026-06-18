package logger

import (
	"log/slog"
	"os"
)

func New() *slog.Logger {
	handler := slog.NewTextHandler(os.Stdout, nil)

	logg := slog.New(handler)

	return logg
}
