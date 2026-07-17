import { JSDOM } from 'jsdom';
import { fetchActionableTree } from './actionable-tree.js';

const CASE1_HTML = `
<body>
  <form>
    <fieldset id="skills-field">
      <legend>What do you want to work on?</legend>
      <p>Select all that apply</p>
      <div class="_option">
        <label><input type="checkbox" name="skills" value="ai" /><span>AI / Agents</span></label>
      </div>
      <div class="_option">
        <label><input type="checkbox" name="skills" value="be" /><span>Backend / API</span></label>
      </div>
      <div class="_option">
        <label><input type="checkbox" name="skills" value="fe" /><span>Frontend / UI</span></label>
      </div>
      <div class="_option">
        <label><input type="checkbox" name="skills" value="mobile" /><span>Mobile</span></label>
      </div>
      <div class="_option">
        <label><input type="checkbox" name="skills" value="infra" /><span>Infrastructure / DevOps</span></label>
      </div>
    </fieldset>
  </form>
</body>
`;

const DECORATED_CHECKBOX_HTML = `
<body>
  <form>
    <fieldset id="skills-field">
      <label for="skills-field">What do you want to work on?</label>
      <div class="field-description"><p>Select all that apply</p></div>
      <div class="option">
        <span class="choice-widget">
          <input type="checkbox" id="skills-0" name="AI / Agents"
            style="opacity:0;position:absolute;width:1px;height:1px" />
        </span>
        <label for="skills-0">AI / Agents</label>
      </div>
      <div class="option">
        <span class="choice-widget">
          <input type="checkbox" id="skills-1" name="Backend / APIs"
            style="opacity:0;position:absolute;width:1px;height:1px" />
        </span>
        <label for="skills-1">Backend / APIs</label>
      </div>
      <div class="option">
        <span class="choice-widget">
          <input type="checkbox" id="skills-2" name="Frontend"
            style="opacity:0;position:absolute;width:1px;height:1px" />
        </span>
        <label for="skills-2">Frontend</label>
      </div>
    </fieldset>
  </form>
</body>
`;

const CASE2_HTML = `
<body>
  <div class="_fieldEntry">
    <label>Are you legally authorized to work in the United States?</label>
    <div class="_container_1svni">
      <input type="checkbox" style="display:none" name="authorized" />
      <button type="button">Yes</button>
      <button type="button">No</button>
    </div>
  </div>
</body>
`;

const SELECT_HTML = `
<body>
  <div class="_fieldEntry">
    <label>Pick an item</label>
    <select name="item" aria-label="Item picker">
      <option value="a">ItemA</option>
      <option value="b">ItemB</option>
      <option value="c">ItemC</option>
    </select>
  </div>
</body>
`;

const COMBOBOX_HTML = `
<body>
  <div class="field-wrapper">
    <div class="select__container">
      <label id="veteran_status-label" for="veteran_status" class="label select__label">Veteran Status</label>
      <div class="select-shell">
        <div class="select__control">
          <div class="select__value-container">
            <div class="select__placeholder" id="react-select-veteran_status-placeholder">Select...</div>
            <div class="select__input-container">
              <input class="select__input" id="veteran_status" type="text" role="combobox"
                aria-autocomplete="list" aria-expanded="false" aria-haspopup="true"
                aria-labelledby="veteran_status-label" value="" />
            </div>
          </div>
          <div class="select__indicators">
            <button type="button" aria-label="Toggle flyout" tabindex="-1">▼</button>
          </div>
        </div>
        <div class="select__menu" style="display:none">
          <div role="listbox" id="react-select-veteran_status-listbox">
            <div role="option" id="react-select-veteran_status-option-0">I am not a protected veteran</div>
            <div role="option" id="react-select-veteran_status-option-1">I identify as one or more of the classifications of a protected veteran</div>
            <div role="option" id="react-select-veteran_status-option-2">I don't wish to answer</div>
          </div>
        </div>
      </div>
    </div>
    <p>Are you a protected veteran under federal law?</p>
  </div>
</body>
`;

const ITI_NOISE_HTML = `
<body>
  <div class="field-wrapper">
    <fieldset class="phone-input">
      <legend>Phone</legend>
      <div class="phone-input__country">
        <div class="select__container">
          <label id="country-label" for="country">Country</label>
          <div class="select-shell">
            <input id="country" class="select__input" type="text" role="combobox" aria-haspopup="true"
              aria-autocomplete="list" aria-labelledby="country-label" aria-controls="react-select-country-listbox" />
            <div class="select__menu">
              <div role="listbox" id="react-select-country-listbox">
                <div role="option">United States +1</div>
                <div role="option">Canada +1</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="phone-input__phone">
        <label id="phone-label" for="phone">Phone</label>
        <div class="iti iti--allow-dropdown">
          <button type="button" class="iti__selected-country" aria-label="Select country"></button>
          <input id="phone" type="tel" class="iti__tel-input" aria-labelledby="phone-label" />
          <input id="iti-0__search-input" class="iti__search-input" role="combobox" aria-controls="iti-0__country-listbox" />
          <div role="listbox" id="iti-0__country-listbox">
            <div role="option">United States+1</div>
            <div role="option">Canada+1</div>
          </div>
        </div>
      </div>
    </fieldset>
  </div>
</body>
`;

const ORPHAN_LINKS_HTML = `
<body>
  <form id="application-form">
    <div class="field-wrapper">
      <label id="disability-label">Disability Status</label>
      <p>Voluntary self-identification. See <a href="https://www.dol.gov/ofccp">OFCCP website</a> for definitions.</p>
      <input id="disability" type="text" role="combobox" aria-labelledby="disability-label" />
    </div>
    <div class="field-wrapper">
      <p>Extra legal copy about veterans and disabilities that should not appear in unrelated groups.</p>
      <a href="#race">Race &amp; Ethnicity Definitions</a>
    </div>
    <button type="submit">Submit application</button>
  </form>
</body>
`;

const FILE_UPLOAD_HTML = `
<body>
  <div role="group" aria-labelledby="upload-label-resume" class="file-upload">
    <div id="upload-label-resume" class="label upload-label">Resume/CV</div>
    <div class="file-upload__wrapper">
      <div class="button-container">
        <div class="secondary-button">
          <div>
            <button type="button" class="btn btn--pill">Attach</button>
            <label class="visually-hidden" for="resume">Attach</label>
            <input id="resume" class="visually-hidden" type="file" accept=".pdf,.doc,.docx,.txt,.rtf" />
          </div>
        </div>
        <div class="secondary-button">
          <button type="button" class="btn btn--pill" data-testid="resume-dropbox">Dropbox</button>
        </div>
        <div class="secondary-button">
          <button type="button" class="btn btn--pill" data-testid="resume-text">Enter manually</button>
        </div>
        <p class="file-upload__filetypes">Accepted file types: pdf, doc, docx, txt, rtf</p>
      </div>
    </div>
  </div>
</body>
`;

const GENERIC_FILE_UPLOAD_HTML = `
<body>
  <form>
    <div class="form-field" data-field-path="resume">
      <label for="resume-file">Resume</label>
      <div role="presentation">
        <input accept=".pdf,.docx" type="file" tabindex="-1" id="resume-file"
          style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)" />
        <button type="button"><span>Upload File</span></button>
        <p>or drag and drop here</p>
      </div>
    </div>
  </form>
</body>
`;

const MULTI_FIELD_BUTTON_GROUP_HTML = `
<body>
  <main>
    <a href="/jobs" aria-label="Back to job listings"></a>
    <section>
      <div class="field-entry">
        <label for="full-name">Legal Full Name</label>
        <div><input id="full-name" name="full-name" type="text" /></div>
      </div>
      <div class="field-entry">
        <label for="resume-file">Resume</label>
        <div role="presentation">
          <input id="resume-file" type="file"
            style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)" />
          <button type="button">Upload File</button>
          <p>or drag and drop here</p>
        </div>
      </div>
      <div class="field-entry">
        <label for="authorized-choice">Are you legally authorized to work in the United States?</label>
        <div>
          <button type="button">Yes</button>
          <button type="button">No</button>
          <input type="checkbox" tabindex="-1" name="06894528-0319-44d0-bf52-22e5efe95607" />
        </div>
      </div>
      <div class="field-entry">
        <label for="sponsorship-choice">Will you now or in the future require visa sponsorship?</label>
        <div>
          <button type="button">Yes</button>
          <button type="button">No</button>
          <input type="checkbox" tabindex="-1" name="c7de9108-b340-4adb-824a-1fc7db990f57" />
        </div>
      </div>
      <div class="field-entry">
        <label id="location-label">Location</label>
        <input type="text" role="combobox" aria-labelledby="location-label" aria-controls="location-listbox" />
        <div role="listbox" id="location-listbox">
          <div role="option">New York, United States</div>
          <div role="option">Chicago, United States</div>
        </div>
      </div>
    </section>
  </main>
</body>
`;

/** Rippling/HiringThing: Dropzone appends hidden file input as direct child of body. */
const RIPPLING_DROPZONE_HTML = `
<body id="openyield">
<div class="content"><div class="jobs-content"><div id="careers-page-job">
<div class="job-content-header"><button class="ob button job-back-button">Back to Jobs</button></div>
<div id="application-form-container"><form id="job-application-form">
<div class="ob deprecated-form-group vertical"><label for="user.first_name">First Name (required)</label>
<input id="user.first_name" name="user.first_name" type="text" class="MuiInputBase-input"></div>
<div class="ob deprecated-form-group vertical"><label for="user.last_name">Last Name (required)</label>
<input id="user.last_name" name="user.last_name" type="text" class="MuiInputBase-input"></div>
<div class="ob deprecated-form-group vertical"><label for="user.email">Email Address (required)</label>
<input id="user.email" name="user.email" type="text" class="MuiInputBase-input"></div>
<div class="ob deprecated-form-group vertical"><label for="user.linkedin_url">LinkedIn URL</label>
<input id="user.linkedin_url" name="user.linkedin_url" type="text" class="MuiInputBase-input"></div>
<div class="ob form-group"><label id="files.Resume.file_label">Resume: (Word/PDF) (required)</label>
<div class="filepicker dropzone dz-clickable"><span>Click or drag files here</span></div></div>
<div class="ob deprecated-form-group vertical"><label for="job_assessment.question_9066558.response">How many years of professional development experience do you have? (required)</label>
<textarea id="job_assessment.question_9066558.response" name="q1" class="ob form-control textarea"></textarea></div>
<div class="ob deprecated-form-group vertical"><label for="app.where_from">Where did you hear about us? (required)</label>
<div class="Select"><input id="app.where_from" role="combobox" aria-autocomplete="list" value="" style="width:5px"></div></div>
<div class="ob form-control checkbox"><label><input type="checkbox" id="subscribe" name="subscribe"><span>Subscribe</span></label></div>
<button type="submit">Submit Application</button>
</form></div></div></div></div>
<div class="footer"><form><input type="email" class="email-input" name="user[email]"></form></div>
<input type="file" class="dz-hidden-input" style="visibility:hidden;height:0;width:0">
</body>
`;

function withDom(html: string, run: (body: HTMLElement) => void | Promise<void>) {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const { window } = dom;
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'HTMLInputElement',
    'Element',
    'Node',
    'NodeFilter',
    'Text',
    'MouseEvent',
    'KeyboardEvent',
    'CSS',
    'MutationObserver',
  ] as const) {
    // @ts-expect-error test shim
    globalThis[key] = window[key];
  }
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const style = window.getComputedStyle(this);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
    }
    return { width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, x: 0, y: 0, toJSON() {} };
  };
  return Promise.resolve(run(window.document.body)).finally(() => dom.window.close());
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

async function runTests() {
  await withDom(CASE1_HTML, async (body) => {
    const tree = await fetchActionableTree(body, { probeComboboxes: false });
    assert(tree.length === 1, `case1: expected 1 group, got ${tree.length}`);
    assert(
      tree[0].content === 'What do you want to work on? Select all that apply',
      `case1 content: "${tree[0].content}"`,
    );
    assert(tree[0].children.length === 5, `case1: expected 5 children, got ${tree[0].children.length}`);
    const targets = tree[0].children.map((c) => c.target);
    assert(
      targets.join('|') ===
        'AI / Agents|Backend / API|Frontend / UI|Mobile|Infrastructure / DevOps',
      `case1 targets: ${targets.join(', ')}`,
    );
    assert(
      tree[0].children.every((c) => c.controlType === 'checkbox'),
      'case1: all controls should be checkbox',
    );
  });

  await withDom(DECORATED_CHECKBOX_HTML, async (body) => {
    for (const input of body.querySelectorAll('input[type="checkbox"]')) {
      (input as HTMLElement).style.opacity = '0';
    }
    const tree = await fetchActionableTree(body, { probeComboboxes: false });
    assert(tree.length === 1, `decorated checkboxes: expected 1 group, got ${tree.length}`);
    assert(
      tree[0].content.includes('What do you want to work on?'),
      `decorated checkboxes content: "${tree[0].content}"`,
    );
    assert(tree[0].children.length === 3, `decorated checkboxes: expected 3 children, got ${tree[0].children.length}`);
    const targets = tree[0].children.map((c) => c.target);
    assert(
      targets.join('|') === 'AI / Agents|Backend / APIs|Frontend',
      `decorated checkbox targets: ${targets.join(', ')}`,
    );
    assert(
      tree[0].children.every((c) => c.controlType === 'checkbox'),
      'decorated checkboxes: all controls should be checkbox',
    );
  });

  await withDom(CASE2_HTML, async (body) => {
    const tree = await fetchActionableTree(body, { probeComboboxes: false });
    assert(tree.length === 1, `case2: expected 1 group, got ${tree.length}`);
    assert(
      tree[0].content === 'Are you legally authorized to work in the United States?',
      `case2 content: "${tree[0].content}"`,
    );
    assert(tree[0].children.length === 2, `case2: expected 2 children, got ${tree[0].children.length}`);
    const targets = tree[0].children.map((c) => c.target);
    assert(targets.join('|') === 'Yes|No', `case2 targets: ${targets.join(', ')}`);
    assert(
      !tree[0].children.some((c) => c.controlType === 'checkbox'),
      'case2: hidden checkbox must not appear',
    );
    assert(
      tree[0].children.every((c) => c.controlType === 'button'),
      'case2: Yes/No should be buttons',
    );
  });

  await withDom(SELECT_HTML, async (body) => {
    const tree = await fetchActionableTree(body, { probeComboboxes: false });
    assert(tree.length === 1, `select: expected 1 group, got ${tree.length}`);
    assert(tree[0].children.length === 1, `select: expected 1 child, got ${tree[0].children.length}`);
    const child = tree[0].children[0];
    assert(child.controlType === 'select', `select controlType: ${child.controlType}`);
    assert(
      child.options?.map((o) => o.label).join('|') === 'ItemA|ItemB|ItemC',
      `select options: ${JSON.stringify(child.options)}`,
    );
    assert(child.optionsSource === 'native', 'select: optionsSource should be native');
    assert(
      !tree[0].content.includes('ItemA'),
      'select: option text must not appear in group content',
    );
  });

const PROMOTION_HTML = `
<body>
  <form id="application-form">
    <div class="field-wrapper">
      <label for="location">Location (City)</label>
      <input id="location" type="text" aria-controls="react-select-location-listbox" />
      <div class="select__menu">
        <div role="listbox" id="react-select-location-listbox">
          <div role="option">New York, United States</div>
          <div role="option">Los Angeles, United States</div>
        </div>
      </div>
    </div>
  </form>
</body>
`;

const PLAIN_TEXT_HTML = `
<body>
  <form id="application-form">
    <div class="field-wrapper">
      <label for="first_name">First Name</label>
      <input id="first_name" type="text" />
    </div>
  </form>
</body>
`;

  await withDom(PROMOTION_HTML, async (body) => {
    const tree = await fetchActionableTree(body, { probeComboboxes: true, probeTimeoutMs: 200 });
    const location = tree.flatMap((g) => g.children).find((c) => c.target.includes('Location'));
    assert(Boolean(location), 'location field should be found');
    assert(location!.controlType === 'combobox', `location promoted to combobox, got ${location!.controlType}`);
    assert(location!.options?.length === 2, `location options: ${location!.options?.length}`);
  });

  await withDom(PLAIN_TEXT_HTML, async (body) => {
    const tree = await fetchActionableTree(body, { probeComboboxes: true, probeTimeoutMs: 100 });
    const firstName = tree.flatMap((g) => g.children).find((c) => c.target.includes('First Name'));
    assert(Boolean(firstName), 'first name should be found');
    assert(firstName!.controlType === 'text', `first name stays text, got ${firstName!.controlType}`);
    assert(!firstName!.options?.length, 'first name should have no options');
  });

  await withDom(COMBOBOX_HTML, async (body) => {
    const input = body.querySelector('#veteran_status') as HTMLInputElement;
    input.setAttribute('aria-controls', 'react-select-veteran_status-listbox');

    const tree = await fetchActionableTree(body, { probeComboboxes: false });
    assert(tree.length >= 1, `combobox: expected at least 1 group, got ${tree.length}`);

    const comboboxChild = tree.flatMap((g) => g.children).find((c) => c.controlType === 'combobox');
    assert(Boolean(comboboxChild), 'combobox: should find combobox child');
    assert(
      comboboxChild!.target === 'Veteran Status',
      `combobox target: "${comboboxChild!.target}"`,
    );
    assert(
      tree.some((g) => g.content.includes('protected veteran under federal law')),
      `combobox group content should include surrounding copy: "${tree.map((g) => g.content).join(' | ')}"`,
    );
    assert(comboboxChild!.control.tag === 'input', 'combobox control should be input');
    assert(
      comboboxChild!.control.properties.some((p) => p.attribute === 'id' && p.pattern === 'veteran_status'),
      'combobox control should target #veteran_status',
    );
    assert(
      !comboboxChild!.target.toLowerCase().includes('select'),
      'combobox target must not be placeholder',
    );
    assert(
      comboboxChild!.options?.length === 3,
      `combobox options: expected 3, got ${comboboxChild!.options?.length}`,
    );
    assert(
      comboboxChild!.optionsSource === 'static-listbox',
      `combobox optionsSource: ${comboboxChild!.optionsSource}`,
    );
  });

  await withDom(ITI_NOISE_HTML, async (body) => {
    const tree = await fetchActionableTree(body, { probeComboboxes: false });
    const comboboxes = tree.flatMap((g) => g.children).filter((c) => c.controlType === 'combobox');
    assert(comboboxes.length === 1, `expected 1 country combobox, got ${comboboxes.length}`);
    assert(comboboxes[0].target === 'Country', `country target: "${comboboxes[0].target}"`);
    assert(comboboxes[0].options?.length === 2, `country options: ${comboboxes[0].options?.length}`);
    assert(
      comboboxes[0].options?.[0].label.includes('United States'),
      'country options should come from react-select listbox, not iti',
    );

    const phone = tree.flatMap((g) => g.children).find((c) => c.target === 'Phone');
    assert(Boolean(phone), 'phone number field should be detected');
    assert(phone!.controlType === 'text', `phone controlType: ${phone!.controlType}`);
    assert(
      phone!.control.properties.some((p) => p.attribute === 'id' && p.pattern === 'phone'),
      'phone control should target #phone',
    );
  });

  await withDom(ORPHAN_LINKS_HTML, async (body) => {
    const tree = await fetchActionableTree(body, { probeComboboxes: false });
    const bodyGroup = tree.find((g) => g.content.includes('Extra legal copy') && g.content.includes('Submit application'));
    assert(!bodyGroup, `should not create one giant page-level group: ${bodyGroup?.content.slice(0, 120)}`);
    for (const group of tree) {
      assert(
        group.content.length < 300,
        `group content too long (${group.content.length} chars): "${group.content.slice(0, 80)}..."`,
      );
    }
    const submit = tree.flatMap((g) => g.children).find((c) => c.target === 'Submit application');
    assert(Boolean(submit), 'submit buttons should appear in the actionable tree');
    assert(submit!.controlType === 'button', `submit controlType: ${submit!.controlType}`);
  });

  await withDom(FILE_UPLOAD_HTML, async (body) => {
    const tree = await fetchActionableTree(body, { probeComboboxes: false });
    assert(tree.length >= 1, `file: expected at least 1 group, got ${tree.length}`);

    const fileGroup = tree.find((g) => g.content === 'Resume/CV');
    assert(Boolean(fileGroup), `file group content: ${tree.map((g) => g.content).join(', ')}`);

    const fileChild = fileGroup!.children.find((c) => c.controlType === 'file');
    assert(Boolean(fileChild), 'file: should find file child');
    assert(fileChild!.target === 'Resume/CV', `file target: "${fileChild!.target}"`);
    assert(
      fileChild!.control.properties.some((p) => p.attribute === 'id' && p.pattern === 'resume'),
      'file control should target #resume',
    );

    const attachButton = fileGroup!.children.find(
      (c) => c.controlType === 'button' && c.target === 'Attach',
    );
    assert(!attachButton, 'file: Attach button should be suppressed when file input exists');

    const dropbox = fileGroup!.children.find((c) => c.target === 'Dropbox');
    assert(Boolean(dropbox), 'file: Dropbox button may remain as separate action');
  });

  await withDom(GENERIC_FILE_UPLOAD_HTML, async (body) => {
    const tree = await fetchActionableTree(body, { probeComboboxes: false });
    const resume = tree.flatMap((g) => g.children).find((c) => c.controlType === 'file');
    assert(Boolean(resume), 'generic: resume file input should be detected');
    assert(resume!.target === 'Resume', `resume target: "${resume!.target}"`);
    assert(
      resume!.control.properties.some((p) => p.attribute === 'id' && p.pattern === 'resume-file'),
      'resume should target #resume-file',
    );
    const uploadBtn = tree.flatMap((g) => g.children).find((c) => c.target.toLowerCase().includes('upload'));
    assert(!uploadBtn, 'generic: Upload File button should be suppressed when file input exists');
  });

  await withDom(MULTI_FIELD_BUTTON_GROUP_HTML, async (body) => {
    const tree = await fetchActionableTree(body, { probeComboboxes: false });
    const groups = tree.map((g) => ({
      content: g.content,
      children: g.children.map((c) => `${c.target}<${c.controlType}>`).join('|'),
    }));

    const resumeGroup = tree.find((g) => g.content === 'Resume');
    assert(Boolean(resumeGroup), `multi-field: resume group missing: ${JSON.stringify(groups)}`);
    assert(
      resumeGroup!.children.some((c) => c.target === 'Resume' && c.controlType === 'file'),
      `multi-field: resume file missing: ${JSON.stringify(resumeGroup!.children)}`,
    );

    const authorized = tree.find((g) =>
      g.content === 'Are you legally authorized to work in the United States?',
    );
    assert(Boolean(authorized), `multi-field: authorized group missing: ${JSON.stringify(groups)}`);
    assert(
      authorized!.children.map((c) => `${c.target}<${c.controlType}>`).join('|') ===
        'Yes<button>|No<button>',
      `multi-field: authorized children: ${JSON.stringify(authorized!.children)}`,
    );
    const yesBtn = authorized!.children.find((c) => c.target === 'Yes');
    assert(
      yesBtn!.control.properties.some((p) => p.attribute === 'text' && p.pattern === 'Yes'),
      'multi-field: Yes button selector should include visible text',
    );

    const sponsorship = tree.find((g) =>
      g.content === 'Will you now or in the future require visa sponsorship?',
    );
    assert(Boolean(sponsorship), `multi-field: sponsorship group missing: ${JSON.stringify(groups)}`);
    assert(
      sponsorship!.children.map((c) => `${c.target}<${c.controlType}>`).join('|') ===
        'Yes<button>|No<button>',
      `multi-field: sponsorship children: ${JSON.stringify(sponsorship!.children)}`,
    );

    const allTargets = tree.flatMap((g) => g.children);
    assert(
      !allTargets.some((c) => c.target.includes('06894528') || c.target.includes('c7de9108')),
      `multi-field: opaque checkbox names leaked: ${JSON.stringify(allTargets)}`,
    );

    const location = allTargets.find((c) => c.target === 'Location');
    assert(Boolean(location), 'multi-field: location combobox missing');
    assert(location!.controlType === 'combobox', `multi-field: location type ${location!.controlType}`);
  });

  await withDom(RIPPLING_DROPZONE_HTML, async (body) => {
    const tree = await fetchActionableTree(body, { probeComboboxes: false });
    const targets = tree.flatMap((g) => g.children);
    const names = targets.map((c) => c.target);

    assert(
      targets.length >= 10,
      `rippling dropzone: expected ≥10 targets, got ${targets.length}: ${names.join(', ')}`,
    );
    assert(names.includes('First Name (required)'), `rippling dropzone: missing First Name: ${names.join(', ')}`);
    assert(names.includes('Last Name (required)'), `rippling dropzone: missing Last Name: ${names.join(', ')}`);
    assert(names.includes('Email Address (required)'), `rippling dropzone: missing Email: ${names.join(', ')}`);
    assert(
      names.includes('How many years of professional development experience do you have? (required)'),
      `rippling dropzone: missing essay textarea: ${names.join(', ')}`,
    );
    assert(
      names.includes('Where did you hear about us? (required)'),
      `rippling dropzone: missing combobox: ${names.join(', ')}`,
    );

    assert(
      !targets.some((c) => c.targetHtml.includes('<body id=')),
      'rippling dropzone: file widget must not use body as child unit',
    );

    const fileTargets = targets.filter((c) => c.controlType === 'file');
    assert(fileTargets.length >= 1, 'rippling dropzone: resume file missing');
    assert(
      fileTargets.every((c) => c.targetHtml.length < 500),
      `rippling dropzone: file targetHtml too large: ${fileTargets.map((c) => c.targetHtml.length).join(', ')}`,
    );

    const submit = targets.find((c) => c.target === 'Submit Application');
    assert(Boolean(submit), `rippling dropzone: missing Submit Application: ${names.join(', ')}`);
    assert(submit!.controlType === 'button', `rippling submit controlType: ${submit!.controlType}`);
  });

  console.log('actionable-tree ok');
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
