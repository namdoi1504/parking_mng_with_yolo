from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    DATABASE_HOSTNAME: str
    DATABASE_PORT: int = 5432
    DATABASE_PASSWORD: str
    DATABASE_NAME: str
    DATABASE_USERNAME: str

    SECRET_KEY: str
    ALGORITHM: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    model_config = SettingsConfigDict(
        env_file=".env",
        env_ignore_empty=True
    )

settings = Settings()