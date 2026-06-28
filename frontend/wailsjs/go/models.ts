export namespace app {
	
	export class HookEntry {
	    matcher?: string;
	    command: string;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new HookEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.matcher = source["matcher"];
	        this.command = source["command"];
	        this.type = source["type"];
	    }
	}
	export class HooksConfig {
	    PreToolUse: HookEntry[];
	    PermissionRequest: HookEntry[];
	    PostToolUse: HookEntry[];
	    Notification: HookEntry[];
	    Stop: HookEntry[];
	
	    static createFrom(source: any = {}) {
	        return new HooksConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.PreToolUse = this.convertValues(source["PreToolUse"], HookEntry);
	        this.PermissionRequest = this.convertValues(source["PermissionRequest"], HookEntry);
	        this.PostToolUse = this.convertValues(source["PostToolUse"], HookEntry);
	        this.Notification = this.convertValues(source["Notification"], HookEntry);
	        this.Stop = this.convertValues(source["Stop"], HookEntry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace jsonl {
	
	export class Message {
	    role: string;
	    content: string;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new Message(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.content = source["content"];
	        this.type = source["type"];
	    }
	}
	export class SessionMeta {
	    id: string;
	    workdir: string;
	    mtime: number;
	    msg_count: number;
	    first_prompt: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new SessionMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.workdir = source["workdir"];
	        this.mtime = source["mtime"];
	        this.msg_count = source["msg_count"];
	        this.first_prompt = source["first_prompt"];
	        this.size = source["size"];
	    }
	}

}

export namespace settings {
	
	export class Config {
	    theme: string;
	    claude_path: string;
	    auto_allow_bash: boolean;
	    log_enabled: boolean;
	    auto_lock_minutes: number;
	    auto_start: boolean;
	    minimize_on_start: boolean;
	    cloud_service_enabled: boolean;
	    cloud_service_url: string;
	    cloud_service_token: string;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.claude_path = source["claude_path"];
	        this.auto_allow_bash = source["auto_allow_bash"];
	        this.log_enabled = source["log_enabled"];
	        this.auto_lock_minutes = source["auto_lock_minutes"];
	        this.auto_start = source["auto_start"];
	        this.minimize_on_start = source["minimize_on_start"];
	        this.cloud_service_enabled = source["cloud_service_enabled"];
	        this.cloud_service_url = source["cloud_service_url"];
	        this.cloud_service_token = source["cloud_service_token"];
	    }
	}

}

export namespace time {
	
	export class Time {
	
	
	    static createFrom(source: any = {}) {
	        return new Time(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	
	    }
	}

}

