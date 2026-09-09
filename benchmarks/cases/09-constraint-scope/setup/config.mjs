export const DEFAULT_PORT = 8080;

export function loadConfig(env = {}) {
  return {
    port: Number(env.PORT ?? DEFAULT_PORT),
    host: env.HOST ?? "127.0.0.1",
  };
}
