import type { DiagnosticCode } from '@astrojs/compiler/shared/diagnostics.js';
import { AstroErrorCodes } from './errors-data.js';
import { codeFrame } from './printer.js';
import { getErrorDataByCode } from './utils.js';

interface ErrorProperties {
	code: AstroErrorCodes | DiagnosticCode;
	name?: string;
	message?: string;
	location?: ErrorLocation;
	hint?: string;
	stack?: string;
	frame?: string;
}

export interface ErrorLocation {
	file?: string;
	line?: number;
	column?: number;
}

type ErrorTypes =
	| 'AstroError'
	| 'CompilerError'
	| 'CSSError'
	| 'MarkdownError'
	| 'InternalError'
	| 'AggregateError';

export class AstroError extends Error {
	public code: AstroErrorCodes | DiagnosticCode;
	public loc: ErrorLocation | undefined;
	public hint: string | undefined;
	public frame: string | undefined;

	type: ErrorTypes = 'AstroError';

	constructor(props: ErrorProperties, ...params: any) {
		super(...params);

		const { code, name, message, stack, location, hint, frame } = props;

		this.code = code;
		if (name) {
			this.name = name;
		} else {
			// If we don't have a name, let's generate one from the code
			this.name = getErrorDataByCode(this.code)?.name ?? 'UnknownError';
		}
		if (message) this.message = message;
		// Only set this if we actually have a stack passed, otherwise uses Error's
		this.stack = stack ? stack : this.stack;
		this.loc = location;
		this.hint = hint;
		this.frame = frame;
	}

	public setErrorCode(errorCode: AstroErrorCodes) {
		this.code = errorCode;

		this.name = getErrorDataByCode(this.code)?.name ?? 'UnknownError';
	}

	public setLocation(location: ErrorLocation): void {
		this.loc = location;
	}

	public setName(name: string): void {
		this.name = name;
	}

	public setMessage(message: string): void {
		this.message = message;
	}

	public setHint(hint: string): void {
		this.hint = hint;
	}

	public setFrame(source: string, location: ErrorLocation): void {
		this.frame = codeFrame(source, location);
	}

	static is(err: Error | unknown): err is AstroError {
		return (err as AstroError).type === 'AstroError';
	}
}

export class CompilerError extends AstroError {
	type: ErrorTypes = 'CompilerError';

	constructor(props: Omit<ErrorProperties, 'code'> & { code: DiagnosticCode }, ...params: any) {
		super(props, ...params);

		this.name = 'CompilerError';
	}

	static is(err: Error | unknown): err is CompilerError {
		return (err as CompilerError).type === 'CompilerError';
	}
}

export class CSSError extends AstroError {
	type: ErrorTypes = 'CSSError';

	static is(err: Error | unknown): err is CSSError {
		return (err as CSSError).type === 'CSSError';
	}
}

export class MarkdownError extends AstroError {
	type: ErrorTypes = 'MarkdownError';

	static is(err: Error | unknown): err is MarkdownError {
		return (err as MarkdownError).type === 'MarkdownError';
	}
}

export class InternalError extends AstroError {
	type: ErrorTypes = 'InternalError';

	static is(err: Error | unknown): err is InternalError {
		return (err as InternalError).type === 'InternalError';
	}
}

export class AggregateError extends AstroError {
	type: ErrorTypes = 'AggregateError';
	errors: AstroError[];

	// Despite being a collection of errors, AggregateError still needs to have a main error attached to it
	// This is because Vite expects every thrown errors handled during HMR to be, well, Error and have a message
	constructor(props: ErrorProperties & { errors: AstroError[] }, ...params: any) {
		super(props, ...params);

		this.errors = props.errors;
	}

	static is(err: Error | unknown): err is AggregateError {
		return (err as AggregateError).type === 'AggregateError';
	}
}

/**
 * Generic object representing an error with all possible data
 * Compatible with both Astro's and Vite's errors
 */
export interface ErrorWithMetadata {
	[name: string]: any;
	name: string;
	type?: ErrorTypes;
	message: string;
	stack: string;
	code?: number;
	hint?: string;
	id?: string;
	frame?: string;
	plugin?: string;
	pluginCode?: string;
	loc?: {
		file?: string;
		line?: number;
		column?: number;
	};
	cause?: any;
}
