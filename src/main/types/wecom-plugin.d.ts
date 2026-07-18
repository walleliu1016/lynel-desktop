declare module '@wecom/wecom-openclaw-plugin' {
  const mod: any;
  export default mod;
}

declare module '@wecom/aibot-node-sdk' {
  const mod: any;
  export = mod;
}

// 补充 template_card 相关类型，避免 any 泛滥
declare module '@wecom/aibot-node-sdk/dist/types/api' {
  export interface SendTemplateCardMsgBody {
    msgtype: 'template_card';
    template_card: any;
  }
}
