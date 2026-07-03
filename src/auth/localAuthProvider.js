// createLocalAuthProvider — sample username/password AuthProvider backed by localStorage
// (doc 03 §2.1/§2.3 reference implementations, adapted to simple-admin's resolve=allow/
// reject=deny convention). Intended for demos/dev, not production auth.

const STORAGE_KEY = 'sa-auth';

const DEFAULT_USERS = [{ username: 'admin', password: 'admin', fullName: 'Administrator' }];

const readSession = () => {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
};

export const createLocalAuthProvider = ({ users = DEFAULT_USERS } = {}) => ({
  async login({ username, password } = {}) {
    const user = users.find((u) => u.username === username && u.password === password);
    if (!user) throw new Error('Invalid username or password');
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ id: user.username, fullName: user.fullName || user.username })
    );
  },

  async logout() {
    localStorage.removeItem(STORAGE_KEY);
  },

  async checkAuth() {
    if (!readSession()) throw new Error('Not authenticated');
  },

  async checkError(error) {
    const status = error && error.status;
    if (status === 401 || status === 403) {
      localStorage.removeItem(STORAGE_KEY);
      throw new Error('Session expired');
    }
    // any other status: not an auth error, resolve so the UI shows it normally
  },

  async getIdentity() {
    const session = readSession();
    if (!session) throw new Error('Not authenticated');
    return { id: session.id, fullName: session.fullName };
  },

  async getPermissions() {
    return [];
  },
});

export default createLocalAuthProvider;
