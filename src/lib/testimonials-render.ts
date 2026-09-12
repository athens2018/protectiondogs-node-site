// Adapts the CMS's TestimonialsSection (src/lib/cms.ts) into the exact
// prop shape src/components/sections/Testimonials.astro expects. Quotes
// are never localized (see cms.ts's TestimonialEntry.quote comment), so
// unlike toDogsProps/toFaqProps this needs no `locale` argument.
import { approvedTestimonials, type TestimonialsSection } from './cms';

export function toTestimonialsProps(section: TestimonialsSection) {
  return {
    testimonials: approvedTestimonials(section).map((t) => ({
      name: t.name,
      location: t.location,
      rating: t.rating,
      quote: t.quote,
    })),
  };
}
