import { useState, useEffect, useContext } from 'react';
import { ToastContext } from '../ToastContext';

function ProfileTab() {
    const showToast = useContext(ToastContext);
    const [profile, setProfile] = useState({
        name: '', email: '', phone: '', location: '', gender: '', date_of_birth: '',
        linkedin_url: '', github_url: '', portfolio_url: '',
        current_title: '', years_experience: 0, education_level: '', graduation_year: 0, gpa: '',
        expected_ctc: '', current_ctc: '', notice_period: '',
        willing_to_relocate: false, work_authorized: false,
        cover_letter_template: '', skills: []
    });
    const [skillInput, setSkillInput] = useState('');

    useEffect(() => {
        loadProfile();
    }, []);

    const loadProfile = async () => {
        try {
            const res = await fetch('/api/profile');
            const data = await res.json();
            
            let skills = data.skills || [];
            if (typeof skills === 'string') {
                try { skills = JSON.parse(skills); } catch { skills = []; }
            }
            
            setProfile({
                ...data,
                skills: Array.isArray(skills) ? skills : []
            });
        } catch (err) {
            console.error("Error loading profile", err);
        }
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setProfile(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSkillKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const skill = skillInput.replace(',', '').trim();
            if (skill && !profile.skills.includes(skill)) {
                setProfile(prev => ({ ...prev, skills: [...prev.skills, skill] }));
            }
            setSkillInput('');
        }
        if (e.key === 'Backspace' && !skillInput && profile.skills.length > 0) {
            setProfile(prev => ({ ...prev, skills: prev.skills.slice(0, -1) }));
        }
    };

    const removeSkill = (idx) => {
        setProfile(prev => {
            const newSkills = [...prev.skills];
            newSkills.splice(idx, 1);
            return { ...prev, skills: newSkills };
        });
    };

    const saveProfile = async () => {
        try {
            const res = await fetch('/api/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...profile,
                    years_experience: parseInt(profile.years_experience) || 0,
                    graduation_year: parseInt(profile.graduation_year) || 0,
                    skills: JSON.stringify(profile.skills)
                })
            });
            if (res.ok) showToast('✅ Profile saved!');
            else showToast('Failed to save profile', 'error');
        } catch (err) {
            showToast('Error saving profile', 'error');
            console.error(err);
        }
    };

    return (
        <div>
            <div className="toolbar">
                <h2>Your Profile</h2>
                <button onClick={saveProfile}>Save Changes</button>
            </div>

            <form onSubmit={e => e.preventDefault()}>
                <div className="form-section">
                    <h3>Personal Info</h3>
                    <div className="form-grid">
                        <div className="form-group">
                            <label>Full Name</label>
                            <input type="text" name="name" value={profile.name || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>Email</label>
                            <input type="email" name="email" value={profile.email || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>Phone</label>
                            <input type="text" name="phone" value={profile.phone || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>Location</label>
                            <input type="text" name="location" value={profile.location || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>Gender</label>
                            <select name="gender" value={profile.gender || ''} onChange={handleChange}>
                                <option value="">Prefer not to say</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Non-binary">Non-binary</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Date of Birth</label>
                            <input type="text" name="date_of_birth" placeholder="e.g. 1998-05-15" value={profile.date_of_birth || ''} onChange={handleChange} />
                        </div>
                    </div>
                </div>

                <div className="form-section">
                    <h3>Links</h3>
                    <div className="form-grid">
                        <div className="form-group">
                            <label>LinkedIn URL</label>
                            <input type="text" name="linkedin_url" value={profile.linkedin_url || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>GitHub URL</label>
                            <input type="text" name="github_url" value={profile.github_url || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>Portfolio URL</label>
                            <input type="text" name="portfolio_url" value={profile.portfolio_url || ''} onChange={handleChange} />
                        </div>
                    </div>
                </div>

                <div className="form-section">
                    <h3>Experience & Education</h3>
                    <div className="form-grid">
                        <div className="form-group">
                            <label>Current Title</label>
                            <input type="text" name="current_title" value={profile.current_title || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>Years of Experience</label>
                            <input type="number" name="years_experience" value={profile.years_experience || 0} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>Education Level</label>
                            <input type="text" name="education_level" value={profile.education_level || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>Graduation Year</label>
                            <input type="number" name="graduation_year" value={profile.graduation_year || 0} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>GPA</label>
                            <input type="text" name="gpa" value={profile.gpa || ''} onChange={handleChange} />
                        </div>
                    </div>
                </div>

                <div className="form-section">
                    <h3>Skills</h3>
                    <div className="form-group">
                        <label>Add skills (press Enter or comma to add)</label>
                        <div className="skills-container" onClick={() => document.getElementById('skills-input').focus()}>
                            {profile.skills.map((skill, idx) => (
                                <span key={idx} className="skill-tag">
                                    {skill} <span className="remove-skill" onClick={(e) => { e.stopPropagation(); removeSkill(idx); }}>&times;</span>
                                </span>
                            ))}
                            <input 
                                type="text" 
                                className="skills-input" 
                                id="skills-input" 
                                placeholder="Type a skill..."
                                value={skillInput}
                                onChange={e => setSkillInput(e.target.value)}
                                onKeyDown={handleSkillKeyDown}
                            />
                        </div>
                    </div>
                </div>

                <div className="form-section">
                    <h3>Screening Details</h3>
                    <div className="form-grid">
                        <div className="form-group">
                            <label>Expected CTC</label>
                            <input type="text" name="expected_ctc" value={profile.expected_ctc || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>Current CTC</label>
                            <input type="text" name="current_ctc" value={profile.current_ctc || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                            <label>Notice Period</label>
                            <input type="text" name="notice_period" value={profile.notice_period || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group checkbox-group">
                            <input type="checkbox" name="willing_to_relocate" id="p_relocate" checked={!!profile.willing_to_relocate} onChange={handleChange} />
                            <label htmlFor="p_relocate">Willing to Relocate</label>
                        </div>
                        <div className="form-group checkbox-group">
                            <input type="checkbox" name="work_authorized" id="p_auth" checked={!!profile.work_authorized} onChange={handleChange} />
                            <label htmlFor="p_auth">Work Authorized</label>
                        </div>
                    </div>
                </div>

                <div className="form-section">
                    <h3>Templates</h3>
                    <div className="form-group">
                        <label>Cover Letter / About Me</label>
                        <textarea name="cover_letter_template" rows="6" value={profile.cover_letter_template || ''} onChange={handleChange}></textarea>
                    </div>
                </div>
            </form>
        </div>
    );
}

export default ProfileTab;
