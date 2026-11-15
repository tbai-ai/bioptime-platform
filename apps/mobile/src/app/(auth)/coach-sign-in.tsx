import React from 'react';
import { WorkspaceSignIn } from '@/components/workspaceSignIn';

/** The coach sign-in (the portal's /login/coach): email and password, workspace 'coach'. */
export default function CoachSignIn() { return <WorkspaceSignIn workspace="coach" />; }
