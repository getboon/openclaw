export declare const DOCTOR_DISABLE_CROSS_STATE_DIR_IMPORTS_ENV = "OPENCLAW_DOCTOR_DISABLE_CROSS_STATE_DIR_IMPORTS";
/** Direct CLI doctor owns cross-state imports unless its automation parent denies them. */
export declare function resolveDoctorCrossStateDirImports(env?: NodeJS.ProcessEnv): boolean;
