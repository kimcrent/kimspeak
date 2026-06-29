package config

import (
	"log"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	HTTPAddr              string
	HTTPReadHeaderTimeout time.Duration
	HTTPReadTimeout       time.Duration
	HTTPWriteTimeout      time.Duration
	HTTPIdleTimeout       time.Duration
	DatabaseURL           string
	DatabaseMaxConns      int32
	DatabaseMinConns      int32
	DatabaseMaxLifetime   time.Duration
	DatabaseMaxIdleTime   time.Duration
	DatabaseHealthPeriod  time.Duration
	DatabasePingTimeout   time.Duration
	JWTSecret             string
}

func Load() Config {
	err := godotenv.Load()
	if err != nil {
		log.Println(".env file not found, using system environment variables")
	}

	return Config{
		HTTPAddr:              getEnv("HTTP_ADDR", ":8080"),
		HTTPReadHeaderTimeout: getDurationEnv("HTTP_READ_HEADER_TIMEOUT", 5*time.Second),
		HTTPReadTimeout:       getDurationEnv("HTTP_READ_TIMEOUT", 15*time.Second),
		HTTPWriteTimeout:      getDurationEnv("HTTP_WRITE_TIMEOUT", 30*time.Second),
		HTTPIdleTimeout:       getDurationEnv("HTTP_IDLE_TIMEOUT", 60*time.Second),
		DatabaseURL:           getEnv("DATABASE_URL", ""),
		DatabaseMaxConns:      getInt32Env("DATABASE_MAX_CONNS", 16),
		DatabaseMinConns:      getInt32Env("DATABASE_MIN_CONNS", 2),
		DatabaseMaxLifetime:   getDurationEnv("DATABASE_MAX_LIFETIME", time.Hour),
		DatabaseMaxIdleTime:   getDurationEnv("DATABASE_MAX_IDLE_TIME", 5*time.Minute),
		DatabaseHealthPeriod:  getDurationEnv("DATABASE_HEALTH_PERIOD", time.Minute),
		DatabasePingTimeout:   getDurationEnv("DATABASE_PING_TIMEOUT", 5*time.Second),
		JWTSecret:             getEnv("JWT_SECRET", "dev-secret-change-me"),
	}
}

func getEnv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}

func getDurationEnv(key string, fallback time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	duration, err := time.ParseDuration(value)
	if err != nil {
		log.Printf("invalid %s=%q, using %s", key, value, fallback)
		return fallback
	}

	return duration
}

func getInt32Env(key string, fallback int32) int32 {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	parsed, err := strconv.ParseInt(value, 10, 32)
	if err != nil || parsed < 0 {
		log.Printf("invalid %s=%q, using %d", key, value, fallback)
		return fallback
	}

	return int32(parsed)
}
