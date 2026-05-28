export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "openagent"}:${input.password}`)
}
