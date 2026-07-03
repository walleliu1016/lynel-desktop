export namespace jsonl {
	
	export class Message {
	    role: string;
	    content: number[];
	    type: string;
	    timestamp: number;
	
	    static createFrom(source: any = {}) {
	        return new Message(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.content = source["content"];
	        this.type = source["type"];
	        this.timestamp = source["timestamp"];
	    }
	}
	export class SessionMeta {
	    id: string;
	    workdir: string;
	    project: string;
	    mtime: number;
	    msg_count: number;
	    first_prompt: string;
	    ai_title: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new SessionMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.workdir = source["workdir"];
	        this.project = source["project"];
	        this.mtime = source["mtime"];
	        this.msg_count = source["msg_count"];
	        this.first_prompt = source["first_prompt"];
	        this.ai_title = source["ai_title"];
	        this.size = source["size"];
	    }
	}
	export class ToolExecution {
	    id: string;
	    kind: string;
	    name: string;
	    startedAt: number;
	    endedAt: number;
	    durationMs: number;
	    status: string;
	    input: string;
	    output: string;
	    exitCode: number;
	
	    static createFrom(source: any = {}) {
	        return new ToolExecution(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.startedAt = source["startedAt"];
	        this.endedAt = source["endedAt"];
	        this.durationMs = source["durationMs"];
	        this.status = source["status"];
	        this.input = source["input"];
	        this.output = source["output"];
	        this.exitCode = source["exitCode"];
	    }
	}

}

export namespace providers {
	
	export class Provider {
	    id: string;
	    name: string;
	    base_url: string;
	    auth_token: string;
	    default_model: string;
	    default_haiku_model: string;
	    default_sonnet_model: string;
	    default_opus_model: string;
	    reasoning_model: string;
	
	    static createFrom(source: any = {}) {
	        return new Provider(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.base_url = source["base_url"];
	        this.auth_token = source["auth_token"];
	        this.default_model = source["default_model"];
	        this.default_haiku_model = source["default_haiku_model"];
	        this.default_sonnet_model = source["default_sonnet_model"];
	        this.default_opus_model = source["default_opus_model"];
	        this.reasoning_model = source["reasoning_model"];
	    }
	}
	export class Config {
	    active_provider_id: string;
	    providers: Provider[];
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.active_provider_id = source["active_provider_id"];
	        this.providers = this.convertValues(source["providers"], Provider);
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

