import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ThaliTemplate } from './thali-template.entity';
import { ThaliSection } from './thali-section.entity';
import { ThaliOption } from './thali-option.entity';
import {
  CreateThaliTemplateDto, CreateThaliSectionDto, CreateThaliOptionDto,
} from './create-thali.dto';
import {
  UpdateThaliTemplateDto, UpdateThaliSectionDto, UpdateThaliOptionDto,
} from './update-thali.dto';

const num = (v: unknown) => Number(v ?? 0); // PG numeric arrives as string

@Injectable()
export class ThaliService {
  constructor(
    @InjectRepository(ThaliTemplate) private templates: Repository<ThaliTemplate>,
    @InjectRepository(ThaliSection) private sections: Repository<ThaliSection>,
    @InjectRepository(ThaliOption) private options: Repository<ThaliOption>,
  ) {}

  /* ── public: active templates, nested + ordered, available options only ── */
  async findAllPublic() {
    const list = await this.templates.find({
      where: { status: 'active' },
      relations: { sections: { options: true } },
      order: { id: 'ASC' },
    });
    return list.map((t) => ({
      id: Number(t.id),
      name: t.name,
      basePrice: num(t.basePrice),
      image: t.image,
      sections: (t.sections || [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => ({
          id: Number(s.id),
          name: s.name,
          minSelect: s.minSelect,
          maxSelect: s.maxSelect,
          options: (s.options || [])
            .filter((o) => o.isAvailable)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((o) => ({
              id: Number(o.id),
              name: o.name,
              extraPrice: num(o.extraPrice), // per-portion price
              calories: o.calories ?? 0,
              protein: num(o.protein),
              image: o.image,
              maxQty: o.maxQty ?? 1,
            })),
        })),
    }));
  }

  /* ── admin: everything, including inactive/unavailable ── */
  findAllAdmin() {
    return this.templates.find({
      relations: { sections: { options: true } },
      order: { id: 'ASC' },
    });
  }

  /* ── price validation — the security heart. Reused at order time. ──
     Portion model: total = base_price + Σ (unit price × qty).
     Never trust a client total: recompute from {optionId, qty} pairs and
     enforce template ownership, availability, per-option max_qty, and
     per-section min/max TOTAL PORTIONS. */
  async priceCheck(
    templateId: number,
    selections: { optionId: number; qty: number }[],
  ) {
    const t = await this.templates.findOne({
      where: { id: templateId },
      relations: { sections: { options: true } },
    });
    if (!t || t.status !== 'active') {
      throw new NotFoundException('Thali template not found');
    }
    if (!Array.isArray(selections)) {
      throw new BadRequestException('selections must be an array');
    }

    const optionById = new Map<number, { opt: ThaliOption; section: ThaliSection }>();
    for (const s of t.sections || []) {
      for (const o of s.options || []) optionById.set(Number(o.id), { opt: o, section: s });
    }

    // merge duplicates defensively
    const qtyById = new Map<number, number>();
    for (const sel of selections) {
      const id = Number(sel?.optionId);
      const q = Number(sel?.qty);
      if (!Number.isInteger(id) || !Number.isInteger(q) || q <= 0) {
        throw new BadRequestException('Invalid selection entry');
      }
      qtyById.set(id, (qtyById.get(id) || 0) + q);
    }

    const perSectionUnits = new Map<number, number>();
    const breakdown: {
      optionId: number; name: string; section: string; qty: number;
      unitPrice: number; lineTotal: number; calories: number; protein: number;
    }[] = [];

    for (const [id, qty] of qtyById) {
      const hit = optionById.get(id);
      if (!hit) {
        throw new BadRequestException(`Option ${id} does not belong to this thali`);
      }
      if (!hit.opt.isAvailable) {
        throw new BadRequestException(`"${hit.opt.name}" abhi available nahi hai`);
      }
      const maxQty = hit.opt.maxQty ?? 1;
      if (qty > maxQty) {
        throw new BadRequestException(`"${hit.opt.name}" max ${maxQty} portions allowed`);
      }
      perSectionUnits.set(
        Number(hit.section.id),
        (perSectionUnits.get(Number(hit.section.id)) || 0) + qty,
      );
      const unit = num(hit.opt.extraPrice);
      breakdown.push({
        optionId: id,
        name: hit.opt.name,
        section: hit.section.name,
        qty,
        unitPrice: unit,
        lineTotal: unit * qty,
        calories: (hit.opt.calories ?? 0) * qty,
        protein: num(hit.opt.protein) * qty,
      });
    }

    for (const s of t.sections || []) {
      const units = perSectionUnits.get(Number(s.id)) || 0;
      if (units < s.minSelect) {
        throw new BadRequestException(`"${s.name}" mein kam se kam ${s.minSelect} chuno`);
      }
      if (units > s.maxSelect) {
        throw new BadRequestException(`"${s.name}" mein max ${s.maxSelect} portions allowed`);
      }
    }

    const itemsTotal = breakdown.reduce((a, b) => a + b.lineTotal, 0);
    return {
      templateId: Number(t.id),
      templateName: t.name,
      basePrice: num(t.basePrice),
      itemsTotal,
      total: num(t.basePrice) + itemsTotal,
      calories: breakdown.reduce((a, b) => a + b.calories, 0),
      protein: breakdown.reduce((a, b) => a + b.protein, 0),
      breakdown,
    };
  }

  /* ── template CRUD ── */
  createTemplate(dto: CreateThaliTemplateDto) {
    return this.templates.save(this.templates.create({ ...dto, status: dto.status || 'active' }));
  }
  async updateTemplate(id: number, dto: UpdateThaliTemplateDto) {
    const t = await this.templates.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    Object.assign(t, dto, { updatedAt: new Date() });
    return this.templates.save(t);
  }
  async removeTemplate(id: number) {
    await this.templates.delete(id);
    return { deleted: true };
  }

  /* ── section CRUD ── */
  async createSection(dto: CreateThaliSectionDto) {
    const t = await this.templates.findOne({ where: { id: dto.templateId } });
    if (!t) throw new NotFoundException('Template not found');
    return this.sections.save(this.sections.create(dto));
  }
  async updateSection(id: number, dto: UpdateThaliSectionDto) {
    const s = await this.sections.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Section not found');
    Object.assign(s, dto);
    return this.sections.save(s);
  }
  async removeSection(id: number) {
    await this.sections.delete(id);
    return { deleted: true };
  }

  /* ── option CRUD ── */
  async createOption(dto: CreateThaliOptionDto) {
    const s = await this.sections.findOne({ where: { id: dto.sectionId } });
    if (!s) throw new NotFoundException('Section not found');
    return this.options.save(this.options.create(dto));
  }
  async updateOption(id: number, dto: UpdateThaliOptionDto) {
    const o = await this.options.findOne({ where: { id } });
    if (!o) throw new NotFoundException('Option not found');
    Object.assign(o, dto);
    return this.options.save(o);
  }
  async removeOption(id: number) {
    await this.options.delete(id);
    return { deleted: true };
  }
}
