import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { FaqCategory } from './faq-category.entity';
import { FaqArticle } from './faq-article.entity';
import {
  CreateFaqArticleDto, CreateFaqCategoryDto, FaqFeedbackDto,
  UpdateFaqArticleDto, UpdateFaqCategoryDto,
} from './dto';
import { AuditService } from '../audit_logs/audit.service';

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

@Injectable()
export class FaqService {
  constructor(
    @InjectRepository(FaqCategory) private readonly cats: Repository<FaqCategory>,
    @InjectRepository(FaqArticle) private readonly arts: Repository<FaqArticle>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /* ─────────── public (storefront) ─────────── */

  /**
   * The whole help centre in ONE call: active categories, each with its active
   * articles. The support page renders offline-ish from this, so a customer
   * with a bad connection still gets answers.
   */
  async publicTree(q?: string) {
    const term = (q || '').trim();
    const cats = await this.cats.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });

    const rows = await this.dataSource.query(
      `SELECT id, category_id AS "categoryId", question, answer,
              action_label AS "actionLabel", action_url AS "actionUrl", sort_order AS "sortOrder"
         FROM faq_articles
        WHERE is_active = true
          AND ($1 = '' OR question ILIKE '%'||$1||'%'
                       OR answer   ILIKE '%'||$1||'%'
                       OR COALESCE(keywords,'') ILIKE '%'||$1||'%')
        ORDER BY sort_order ASC, id ASC`, [term]);

    return cats
      .map((c) => ({
        id: Number(c.id),
        name: c.name,
        slug: c.slug,
        icon: c.icon,
        description: c.description,
        articles: rows
          .filter((a: any) => Number(a.categoryId) === Number(c.id))
          .map((a: any) => ({ ...a, id: Number(a.id) })),
      }))
      // when searching, hide categories with no hits
      .filter((c) => (term ? c.articles.length > 0 : true));
  }

  /** Fire-and-forget view counter — tells the admin what people actually read. */
  async trackView(id: number) {
    await this.dataSource.query(
      `UPDATE faq_articles SET view_count = view_count + 1 WHERE id = $1`, [id]);
    return { ok: true };
  }

  /**
   * "Was this helpful?" — one vote per user per article (re-voting updates).
   * Signed-out visitors can still vote; we just can't dedupe them.
   */
  async feedback(articleId: number, userId: number | null, dto: FaqFeedbackDto) {
    const exists = await this.arts.findOne({ where: { id: articleId } });
    if (!exists) throw new NotFoundException('That help article no longer exists.');

    if (userId) {
      await this.dataSource.query(
        `INSERT INTO faq_feedback (article_id, user_id, helpful, comment)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (article_id, user_id) WHERE user_id IS NOT NULL
         DO UPDATE SET helpful = EXCLUDED.helpful,
                       comment = EXCLUDED.comment,
                       created_at = now()`,
        [articleId, userId, dto.helpful, dto.comment ?? null]);
    } else {
      await this.dataSource.query(
        `INSERT INTO faq_feedback (article_id, user_id, helpful, comment)
         VALUES ($1,NULL,$2,$3)`,
        [articleId, dto.helpful, dto.comment ?? null]);
    }
    return { ok: true };
  }

  /* ─────────── admin ─────────── */

  /**
   * Admin list. Helpful counts are DERIVED from faq_feedback, never stored on
   * the article — two sources of truth for the same number is how reports
   * start disagreeing with reality.
   */
  async adminList() {
    const cats = await this.cats.find({ order: { sortOrder: 'ASC' } });
    const arts = await this.dataSource.query(
      `SELECT a.id, a.category_id AS "categoryId", a.question, a.answer,
              a.action_label AS "actionLabel", a.action_url AS "actionUrl",
              a.keywords, a.sort_order AS "sortOrder", a.is_active AS "isActive",
              a.view_count AS "viewCount",
              COUNT(f.id) FILTER (WHERE f.helpful)      ::int AS "helpfulYes",
              COUNT(f.id) FILTER (WHERE NOT f.helpful)  ::int AS "helpfulNo"
         FROM faq_articles a
         LEFT JOIN faq_feedback f ON f.article_id = a.id
        GROUP BY a.id
        ORDER BY a.sort_order ASC, a.id ASC`);

    return {
      categories: cats.map((c) => ({ ...c, id: Number(c.id) })),
      articles: arts.map((a: any) => ({ ...a, id: Number(a.id), categoryId: Number(a.categoryId) })),
    };
  }

  /** Articles customers marked unhelpful most — i.e. your worst answers. */
  async problemArticles() {
    return this.dataSource.query(
      `SELECT a.id, a.question,
              COUNT(f.id) FILTER (WHERE NOT f.helpful)::int AS "notHelpful",
              COUNT(f.id) FILTER (WHERE f.helpful)::int     AS "helpful",
              a.view_count AS "viewCount"
         FROM faq_articles a
         JOIN faq_feedback f ON f.article_id = a.id
        GROUP BY a.id
       HAVING COUNT(f.id) FILTER (WHERE NOT f.helpful) > 0
        ORDER BY "notHelpful" DESC
        LIMIT 20`);
  }

  async createCategory(dto: CreateFaqCategoryDto, req?: any) {
    const slug = slugify(dto.slug || dto.name);
    const clash = await this.cats.findOne({ where: { slug } });
    if (clash) throw new BadRequestException(`A category with the slug "${slug}" already exists.`);
    const saved = await this.cats.save(this.cats.create({ ...dto, slug }));
    await this.audit.log('faq_category.create', 'faq_categories', saved.id, { name: saved.name }, req);
    return saved;
  }

  async updateCategory(id: number, dto: UpdateFaqCategoryDto, req?: any) {
    const cat = await this.cats.findOne({ where: { id } });
    if (!cat) throw new NotFoundException('Category not found.');
    const before = { ...cat };
    Object.assign(cat, dto);
    if (dto.name && !dto.slug) cat.slug = slugify(dto.name);
    const saved = await this.cats.save(cat);
    await this.audit.logUpdate('faq_categories', id, before, dto as any, req);
    return saved;
  }

  async removeCategory(id: number, req?: any) {
    const cat = await this.cats.findOne({ where: { id } });
    if (!cat) throw new NotFoundException('Category not found.');
    const [{ count }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM faq_articles WHERE category_id = $1`, [id]);
    if (Number(count) > 0) {
      throw new BadRequestException(
        `"${cat.name}" still has ${count} article(s). Move or delete them first.`);
    }
    await this.cats.remove(cat);
    await this.audit.log('faq_category.delete', 'faq_categories', id, { name: cat.name }, req);
    return { deleted: true, id };
  }

  async createArticle(dto: CreateFaqArticleDto, req?: any) {
    const cat = await this.cats.findOne({ where: { id: dto.categoryId } });
    if (!cat) throw new BadRequestException('Pick a valid category for this article.');
    const saved = await this.arts.save(this.arts.create(dto));
    await this.audit.log('faq_article.create', 'faq_articles', saved.id,
      { question: saved.question, category: cat.name }, req);
    return saved;
  }

  async updateArticle(id: number, dto: UpdateFaqArticleDto, req?: any) {
    const art = await this.arts.findOne({ where: { id } });
    if (!art) throw new NotFoundException('Article not found.');
    const before = { ...art };
    Object.assign(art, dto);
    const saved = await this.arts.save(art);
    await this.audit.logUpdate('faq_articles', id, before, dto as any, req,
      ['question', 'answer', 'categoryId', 'isActive', 'sortOrder']);
    return saved;
  }

  async removeArticle(id: number, req?: any) {
    const art = await this.arts.findOne({ where: { id } });
    if (!art) throw new NotFoundException('Article not found.');
    await this.arts.remove(art);
    await this.audit.log('faq_article.delete', 'faq_articles', id, { question: art.question }, req);
    return { deleted: true, id };
  }
}
