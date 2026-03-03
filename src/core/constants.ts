export const IGNORE_PATTERN =
  '**/{node_modules,.git,dist,out,build,.turbo,.next,coverage,venv,.venv,__pycache__,.mypy_cache,.pytest_cache,.tox,.eggs,*.egg-info}/**';

export const SEARCHABLE_EXTENSIONS =
  '**/*.{ts,tsx,js,jsx,py,go,java,cs,php,rb,rs,json,yml,yaml,md,txt,toml,cfg,ini,sh,bash,html,css,scss,less,vue,svelte,sql,graphql,proto,xml,env.example,kt,swift,dart,lua,zig,c,h,cpp,hpp}';

export const SEARCHABLE_EXTENSIONS_BARE =
  '*.{ts,tsx,js,jsx,py,go,java,cs,php,rb,rs,json,yml,yaml,md,txt,toml,cfg,ini,sh,html,css,vue,svelte,sql,graphql,proto,kt,swift,dart,lua,zig,c,h,cpp,hpp}';

export const CODE_EXTENSIONS_RE =
  /\.(py|ts|tsx|js|jsx|go|rs|java|cs|php|rb|kt|swift|dart|c|cpp|h|hpp|lua|zig|vue|svelte)$/;

export const CODE_EXTENSIONS_WITH_DATA_RE =
  /\.(py|ts|tsx|js|jsx|go|rs|java|cs|php|rb|kt|swift|dart|c|cpp|h|hpp|lua|zig|vue|svelte|sql|graphql|proto)$/;

export const MAX_FILE_SIZE = 500_000;
export const MAX_TOOL_RESULT_CHARS = 8000;
export const MAX_CONTEXT_CHARS = 100_000;

export const EXTENSION_NAME = 'AI Assistant';
