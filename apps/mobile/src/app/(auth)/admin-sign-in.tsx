import React from 'react';
import { WorkspaceSignIn } from '@/components/workspaceSignIn';

/** The administrator sign-in (the portal's /login/admin): email, password and the authenticator code, workspace 'admin'. */
export default function AdminSignIn() { return <WorkspaceSignIn workspace="admin" />; }
