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

