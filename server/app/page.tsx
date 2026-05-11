export default function Home() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION
  const sha = process.env.NEXT_PUBLIC_GIT_SHA
  return (
    <main style={{ fontFamily: 'monospace', padding: 32 }}>
      <h1>Focus Server</h1>
      <p>API is running. Visit <a href="/admin">/admin</a> for the debug console.</p>
      <p style={{ marginTop: 24, color: '#6b7280', fontSize: 12 }}>
        Version {version} · {sha}
      </p>
    </main>
  )
}
