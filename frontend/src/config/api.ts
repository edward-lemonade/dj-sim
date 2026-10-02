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
  recording: {
    list: '/recordings',
    upload: '/recordings/upload',
    update: (id: string) => `/recordings/${id}`,
    audio: (id: string) => `/recordings/${id}/audio`,
    download: (id: string) => `/recordings/${id}/download`,
    remove: (id: string) => `/recordings/${id}`,
  },
  stream: {
    list: '/streams',
    create: '/streams',
    join: (id: string) => `/streams/${id}/join`,
    end: (id: string) => `/streams/${id}/end`,
    endOnExit: (id: string) => `/streams/${id}/end-on-exit`,
  },
}

export default API_ROUTES
