# Technical Plan

## Status

**Phase:** Implementation

## Requirements Summary

从系统中移除 OpenAPI 模块及相关代码：

1. 删除 OpenAPI 模块（controller, service, guard, types, module）
2. 从 app.module.ts 移除 OpenApiModule 导入
3. 从 user.constants.ts 移除 SystemBotId.OPENAPI
4. 创建数据库迁移：删除 api_key 表和 bot_openapi 用户
5. 在浏览器中验证用户下拉列表不再有 openapi bot

## Technical Design

### 1. 删除的模块文件

- `apps/api-server/src/openapi/openapi.module.ts`
- `apps/api-server/src/openapi/openapi.controller.ts`
- `apps/api-server/src/openapi/openapi.service.ts`
- `apps/api-server/src/openapi/openapi.guard.ts`
- `apps/api-server/src/openapi/types/openapi.types.ts`
- 删除整个 `apps/api-server/src/openapi/` 目录

### 2. 修改 app.module.ts

移除 OpenApiModule 导入和引用

### 3. 修改 user.constants.ts

从 SystemBotId enum 中移除 OPENAPI = 'bot_openapi'

### 4. 数据库迁移

创建新的迁移文件：

- 删除 api_key 表
- 删除 user 表中 id='bot_openapi' 的记录

### 5. 验证

在浏览器中打开用户下拉列表，确认没有 "OpenAPI Bot" 选项

## Implementation Steps

- [x] 探索 OpenAPI 模块相关代码
- [x] 删除 OpenAPI 模块目录
- [x] 从 app.module.ts 移除 OpenApiModule
- [x] 从 user.constants.ts 移除 SystemBotId.OPENAPI
- [x] 创建数据库迁移文件
- [x] 运行数据库迁移
- [x] 运行类型检查确保无错误
- [x] 运行构建确保无错误
- [ ] 浏览器验证用户下拉列表

## Review Checklist

- [x] `pnpm type-check` passes
- [x] `pnpm build` passes
- [x] Database migration runs successfully
- [ ] Browser verification: no OpenAPI Bot in user dropdown
