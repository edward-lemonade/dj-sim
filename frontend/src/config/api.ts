export const API_ROUTES = {
  user: {
    me: '/user/me',
    register: '/user',
  },
  track: {
    list: '/tracks',
    upload: '/tracks/upload',
    update: (id: string) => `/tracks/${id}`,
    audio: (id: string) => `/tracks/${id}/audio`,
    remove: (id: string) => `/tracks/${id}`,
    analyze: (id: string) => `/tracks/${id}/analyze`,
    cancelAnalysis: (id: string) => `/tracks/${id}/analyze/cancel`,
  },
}

export default API_ROUTES
