import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import App from '../App';
import { transitionSessionLifecycle } from '../src/features/session/application/sessionLifecycle';
import { sessionService } from '../src/features/session/application/sessionService';

jest.mock('../src/api/courseBackend', () => ({
  getBackendHealth: jest.fn().mockResolvedValue({
    ok: true,
    service: 'dmi-controlled-backend',
    contractVersion: 1,
  }),
}));

jest.mock('../src/features/session/application/sessionService', () => ({
  sessionService: { login: jest.fn(), logout: jest.fn(), refresh: jest.fn() },
}));

beforeEach(() => {
  transitionSessionLifecycle('logout');
  jest.clearAllMocks();
});

test('renders the reproducible baseline and resolves backend state', async () => {
  const view = await render(<App />);
  expect(view.getByText('CampusOps')).toBeTruthy();
  await waitFor(() => expect(view.getByTestId('backend-status').props.children.join('')).toContain('available'));
});

test('login and logout controls reflect session transitions', async () => {
  jest.mocked(sessionService.login).mockImplementation(async () => {
    transitionSessionLifecycle('login-started');
    transitionSessionLifecycle('login-succeeded');
    return { ok: true, value: { actorId: 'reporter-1', role: 'reporter', expiresIn: 60 } };
  });
  jest.mocked(sessionService.logout).mockImplementation(async () => {
    transitionSessionLifecycle('logout');
    return { ok: true, value: null };
  });
  jest.mocked(sessionService.refresh).mockImplementation(async () => ({ ok: true, value: null }));
  const view = await render(<App />);

  await act(async () => fireEvent.press(view.getByTestId('login-button')));
  await waitFor(() => expect(view.getByTestId('session-state').props.children.join('')).toContain('authenticated'));
  await act(async () => fireEvent.press(view.getByText('Renovar sesión')));
  expect(sessionService.refresh).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.press(view.getByText('Cerrar sesión')));
  await waitFor(() => expect(view.getByTestId('session-state').props.children.join('')).toContain('unauthenticated'));
  expect(sessionService.login).toHaveBeenCalledWith('reporter-1');
  expect(sessionService.logout).toHaveBeenCalledTimes(1);
});
