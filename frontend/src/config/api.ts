export const API_ROUTES = {
  user: {
    me: '/user/me',
    register: '/user',
  },
  track: {
    list: '/tracks',
    upload: '/tracks/upload',
    remove: (id: string) => `/tracks/${id}`,
  },
}

export default API_ROUTES
