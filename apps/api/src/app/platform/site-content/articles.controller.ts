import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { Article, ArticleListItem, Page } from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import { ArticlesService } from './articles.service';
import { ArticleListQueryDto, SaveArticleDto } from './dto/articles.dto';

// The articles of the blog (spec 2026-10-28-public-site-design, 6.1): «Сайт → Статьи» of the admin.
@Controller({ path: 'operator/articles', version: '1' })
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  /** The latest changed first; the archived ones only with `status=archived`; `q` — a part of the RU title. */
  @RequireOperatorPermission('content:manage')
  @Get()
  async list(
    @Query() query: ArticleListQueryDto,
  ): Promise<Page<ArticleListItem>> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const page = await this.articles.list(
      { status: query.status, q: query.q },
      limit,
      offset,
    );
    return { ...page, limit, offset };
  }

  /** 201 with the draft of version 1; 400 `validation_failed`, 400 `media_not_found`; 409 `slug_taken`. */
  @RequireOperatorPermission('content:manage')
  @Post()
  create(@Body() body: SaveArticleDto): Promise<Article> {
    return this.articles.create(body);
  }

  /** 404 `article_not_found`. */
  @RequireOperatorPermission('content:manage')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Article> {
    return this.articles.get(id);
  }

  /**
   * 400 `validation_failed` (also no `version`), 400 `media_not_found`; 404 `article_not_found`; 409 `archived`,
   * `version_conflict`, `slug_locked`, `slug_taken`.
   */
  @RequireOperatorPermission('content:manage')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SaveArticleDto,
  ): Promise<Article> {
    return this.articles.update(id, body);
  }

  /** 400 `translation_required`; 404; 409 `archived`, `already_published`. */
  @RequireOperatorPermission('content:manage')
  @Post(':id/publish')
  @HttpCode(200)
  publish(@Param('id', new ParseUUIDPipe()) id: string): Promise<Article> {
    return this.articles.publish(id);
  }

  /** 404; 409 `archived`, `not_published`. */
  @RequireOperatorPermission('content:manage')
  @Post(':id/unpublish')
  @HttpCode(200)
  unpublish(@Param('id', new ParseUUIDPipe()) id: string): Promise<Article> {
    return this.articles.unpublish(id);
  }

  /** 404; 409 `archived`, `not_draft`. */
  @RequireOperatorPermission('content:manage')
  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id', new ParseUUIDPipe()) id: string): Promise<Article> {
    return this.articles.archive(id);
  }
}
