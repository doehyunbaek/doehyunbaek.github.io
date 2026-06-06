import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  accessToken: null,
};

export const authentication = createSlice({
  name: 'authentication',
  initialState,
  reducers: {
    setToken: (state, action) => {
      state.accessToken = action.payload;
    },
  },
});

export const { setToken } = authentication.actions;

export const selectAccessToken = (state) => state.authentication.accessToken;
export const selectHasToken = (state) => Boolean(selectAccessToken(state));

export default authentication.reducer;
